import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../common/prisma.service";
import type { Role } from "./roles.decorator";

const BCRYPT_SALT_ROUNDS = 12;

/** A refresh token must outlive an access token by weeks, so a clinician is not sent back to the login screen every few hours. */
export const MIN_REFRESH_TOKEN_DAYS = 30;
/**
 * A just-rotated token presented again within this window is a retry that raced
 * the rotation (two requests, one dropped response), not theft: it is refused but
 * the family is kept. After it, reuse is treated as theft and the whole family is revoked.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

export function refreshTokenTtlMs(env: Record<string, string | undefined> = process.env): number {
  const days = Number(env.REFRESH_TOKEN_TTL_DAYS ?? MIN_REFRESH_TOKEN_DAYS);
  return Math.max(MIN_REFRESH_TOKEN_DAYS, Number.isFinite(days) ? days : MIN_REFRESH_TOKEN_DAYS) * 24 * 60 * 60 * 1000;
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  /** ISO timestamp after which the refresh token no longer works. */
  refreshTokenExpiresAt: string;
}

export interface JwtPayload {
  sub: string;
  role: Role;
  /** Clinician tokens. */
  username?: string;
  /** Patient tokens. */
  email?: string;
}

/**
 * Real clinician identity verification, replacing the Phase 0 RolesGuard's
 * `x-role` header placeholder (docs/adr/010-clinician-authentication.md).
 * No self-service signup - accounts are created with scripts/seed-clinician.ts.
 *
 * Sessions: a short-lived access token (JWT) plus an opaque, rotating refresh
 * token valid for at least 30 days. Only the sha256 of a refresh token is stored.
 * Logout, password change and account deactivation revoke refresh tokens
 * server-side; a rotated token presented again revokes its whole family.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService
  ) {}

  async login(username: string, password: string): Promise<LoginResult> {
    const clinician = await this.prisma.clinician.findUnique({ where: { username } });
    // Compare against a fixed dummy hash when the username doesn't exist, so
    // this path takes roughly the same time as a real mismatch - a real
    // account's existence shouldn't be inferable from response timing.
    const passwordHash = clinician?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali";
    const passwordMatches = await bcrypt.compare(password, passwordHash);

    if (!clinician || !passwordMatches || clinician.deactivatedAt) {
      throw new UnauthorizedException("Invalid username or password");
    }

    return this.issue(clinician, randomUUID());
  }

  /**
   * Exchanges a refresh token for a new access token AND a new refresh token
   * (rotation). The presented token is spent either way.
   */
  async refresh(refreshToken: string): Promise<LoginResult> {
    if (typeof refreshToken !== "string" || refreshToken.length === 0) throw new UnauthorizedException("Invalid refresh token");
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(refreshToken) } });
    if (!row) throw new UnauthorizedException("Invalid refresh token");

    if (row.revokedAt) {
      const sinceRotation = Date.now() - row.revokedAt.getTime();
      if (row.revokedReason === "rotated" && sinceRotation <= REFRESH_REUSE_GRACE_MS) {
        throw new UnauthorizedException("Refresh token already used; retry with the newest one");
      }
      // A spent or revoked token coming back: assume it was copied.
      await this.revokeFamily(row.familyId, "reuse_detected");
      throw new UnauthorizedException("Refresh token revoked");
    }
    if (row.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException("Refresh token expired");

    const clinician = await this.prisma.clinician.findUnique({ where: { id: row.clinicianId } });
    if (!clinician || clinician.deactivatedAt) {
      await this.revokeFamily(row.familyId, "account_inactive");
      throw new UnauthorizedException("Account is not active");
    }

    // Claim the token atomically so two racing refreshes cannot both succeed.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "rotated" },
    });
    if (claimed.count === 0) throw new UnauthorizedException("Refresh token already used; retry with the newest one");

    const result = await this.issue(clinician, row.familyId, row.id);
    return result;
  }

  /** Revokes the family of the presented refresh token. Idempotent and silent for unknown tokens. */
  async logout(refreshToken: string): Promise<void> {
    if (typeof refreshToken !== "string" || refreshToken.length === 0) return;
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(refreshToken) } });
    if (row) await this.revokeFamily(row.familyId, "logout");
  }

  /** Password change, deactivation or an admin reset: every session of this clinician ends. */
  async revokeAllForClinician(clinicianId: string, reason: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { clinicianId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }

  private async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  private async issue(
    clinician: { id: string; username: string; role: string },
    familyId: string,
    replacesId?: string
  ): Promise<LoginResult> {
    const payload: JwtPayload = { sub: clinician.id, username: clinician.username, role: clinician.role as Role };
    const accessToken = await this.jwt.signAsync(payload);

    const refreshToken = randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + refreshTokenTtlMs());
    const created = await this.prisma.refreshToken.create({
      data: { clinicianId: clinician.id, familyId, tokenHash: hashRefreshToken(refreshToken), expiresAt },
    });
    if (replacesId) {
      await this.prisma.refreshToken.updateMany({ where: { id: replacesId }, data: { replacedById: created.id } });
    }
    return { accessToken, refreshToken, refreshTokenExpiresAt: expiresAt.toISOString() };
  }

  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  }
}
