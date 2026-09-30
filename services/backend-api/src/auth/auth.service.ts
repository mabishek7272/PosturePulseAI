import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../common/prisma.service";
import type { Role } from "./roles.decorator";

const BCRYPT_SALT_ROUNDS = 12;

export interface JwtPayload {
  sub: string;
  username: string;
  role: Role;
}

/**
 * Real clinician identity verification, replacing the Phase 0 RolesGuard's
 * `x-role` header placeholder (docs/adr/010-clinician-authentication.md).
 * No self-service signup - accounts are created with scripts/seed-clinician.ts.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService
  ) {}

  async login(username: string, password: string): Promise<{ accessToken: string }> {
    const clinician = await this.prisma.clinician.findUnique({ where: { username } });
    // Compare against a fixed dummy hash when the username doesn't exist, so
    // this path takes roughly the same time as a real mismatch - a real
    // account's existence shouldn't be inferable from response timing.
    const passwordHash = clinician?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali";
    const passwordMatches = await bcrypt.compare(password, passwordHash);

    if (!clinician || !passwordMatches) {
      throw new UnauthorizedException("Invalid username or password");
    }

    const payload: JwtPayload = { sub: clinician.id, username: clinician.username, role: clinician.role as Role };
    return { accessToken: await this.jwt.signAsync(payload) };
  }

  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  }
}
