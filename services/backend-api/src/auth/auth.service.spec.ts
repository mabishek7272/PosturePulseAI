import { UnauthorizedException } from "@nestjs/common";
import { AuthService, MIN_REFRESH_TOKEN_DAYS, REFRESH_REUSE_GRACE_MS, hashRefreshToken, refreshTokenTtlMs } from "./auth.service";

interface Clinician {
  id: string;
  username: string;
  passwordHash: string;
  role: string;
  deactivatedAt?: Date | null;
}

interface TokenRow {
  id: string;
  clinicianId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  replacedById: string | null;
}

/** A small in-memory stand-in for the two tables, so rotation and revocation are tested as behaviour. */
function buildService(clinician: Clinician | null) {
  const rows: TokenRow[] = [];
  let seq = 0;
  const matches = (row: TokenRow, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (v === null ? (row as never)[k] === null : (row as never)[k] === v));
  const prisma = {
    clinician: {
      findUnique: jest.fn(async ({ where }: { where: { username?: string; id?: string } }) =>
        clinician && (where.username === clinician.username || where.id === clinician.id) ? clinician : null
      ),
    },
    refreshToken: {
      create: jest.fn(async ({ data }: { data: Omit<TokenRow, "id" | "revokedAt" | "revokedReason" | "replacedById"> }) => {
        const row: TokenRow = { id: `t${++seq}`, revokedAt: null, revokedReason: null, replacedById: null, ...data };
        rows.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: { where: { tokenHash: string } }) => rows.find((r) => r.tokenHash === where.tokenHash) ?? null),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<TokenRow> }) => {
        const hit = rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
    },
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue("signed.jwt.token") };
  return { service: new AuthService(prisma as never, jwt as never), jwt, rows, prisma };
}

async function realClinician(extra: Partial<Clinician> = {}): Promise<Clinician> {
  return { id: "c1", username: "drchen", passwordHash: await AuthService.hashPassword("correct-password-123"), role: "clinician", ...extra };
}

describe("AuthService login", () => {
  it("issues an access token and a refresh token for a correct username/password", async () => {
    const { service, jwt, rows } = buildService(await realClinician());

    const result = await service.login("drchen", "correct-password-123");

    expect(result.accessToken).toBe("signed.jwt.token");
    expect(result.refreshToken.length).toBeGreaterThanOrEqual(64);
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: "c1", username: "drchen", role: "clinician" });
    expect(rows).toHaveLength(1);
  });

  it("stores only the hash of the refresh token, never the token", async () => {
    const { service, rows } = buildService(await realClinician());
    const { refreshToken } = await service.login("drchen", "correct-password-123");
    expect(rows[0]!.tokenHash).toBe(hashRefreshToken(refreshToken));
    expect(JSON.stringify(rows)).not.toContain(refreshToken);
  });

  it("makes the refresh token valid for at least 30 days", async () => {
    const { service, rows } = buildService(await realClinician());
    const before = Date.now();
    await service.login("drchen", "correct-password-123");
    expect(rows[0]!.expiresAt.getTime() - before).toBeGreaterThanOrEqual(MIN_REFRESH_TOKEN_DAYS * 86_400_000 - 1000);
  });

  it("cannot be configured below 30 days", () => {
    expect(refreshTokenTtlMs({ REFRESH_TOKEN_TTL_DAYS: "1" })).toBe(30 * 86_400_000);
    expect(refreshTokenTtlMs({ REFRESH_TOKEN_TTL_DAYS: "90" })).toBe(90 * 86_400_000);
    expect(refreshTokenTtlMs({ REFRESH_TOKEN_TTL_DAYS: "abc" })).toBe(30 * 86_400_000);
  });

  it("rejects an unknown username", async () => {
    const { service } = buildService(null);
    await expect(service.login("nobody", "whatever-password")).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a wrong password for a real username, never issuing a token", async () => {
    const { service, jwt, rows } = buildService(await realClinician());
    await expect(service.login("drchen", "a-wrong-password-1")).rejects.toThrow(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("rejects a deactivated account even with the right password", async () => {
    const { service, rows } = buildService(await realClinician({ deactivatedAt: new Date() }));
    await expect(service.login("drchen", "correct-password-123")).rejects.toThrow(UnauthorizedException);
    expect(rows).toHaveLength(0);
  });
});

describe("AuthService refresh rotation", () => {
  it("returns a new pair and spends the old refresh token", async () => {
    const { service, rows } = buildService(await realClinician());
    const first = await service.login("drchen", "correct-password-123");

    const second = await service.refresh(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(rows[0]!.revokedReason).toBe("rotated");
    expect(rows[0]!.replacedById).toBe(rows[1]!.id);
    expect(rows[1]!.familyId).toBe(rows[0]!.familyId);
    // The new one keeps working.
    await expect(service.refresh(second.refreshToken)).resolves.toBeDefined();
  });

  it("refuses an unknown token", async () => {
    const { service } = buildService(await realClinician());
    await expect(service.refresh("not-a-real-token")).rejects.toThrow(UnauthorizedException);
    await expect(service.refresh("")).rejects.toThrow(UnauthorizedException);
    await expect(service.refresh(undefined as never)).rejects.toThrow(UnauthorizedException);
  });

  it("refuses an expired token", async () => {
    const { service, rows } = buildService(await realClinician());
    const { refreshToken } = await service.login("drchen", "correct-password-123");
    rows[0]!.expiresAt = new Date(Date.now() - 1000);
    await expect(service.refresh(refreshToken)).rejects.toThrow("expired");
  });

  it("treats reuse of a rotated token as theft and revokes the whole family", async () => {
    const { service, rows } = buildService(await realClinician());
    const first = await service.login("drchen", "correct-password-123");
    const second = await service.refresh(first.refreshToken);
    // Move the rotation outside the grace window.
    rows[0]!.revokedAt = new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1000);

    await expect(service.refresh(first.refreshToken)).rejects.toThrow("revoked");

    expect(rows.every((r) => r.revokedAt)).toBe(true);
    expect(rows[1]!.revokedReason).toBe("reuse_detected");
    // The legitimate holder's newest token is dead too.
    await expect(service.refresh(second.refreshToken)).rejects.toThrow(UnauthorizedException);
  });

  it("does not revoke the family for a retry that raced the rotation", async () => {
    const { service, rows } = buildService(await realClinician());
    const first = await service.login("drchen", "correct-password-123");
    const second = await service.refresh(first.refreshToken);

    await expect(service.refresh(first.refreshToken)).rejects.toThrow("retry with the newest");

    expect(rows[1]!.revokedAt).toBeNull();
    await expect(service.refresh(second.refreshToken)).resolves.toBeDefined();
  });

  it("refuses to refresh once the account is deactivated and ends the family", async () => {
    const clinician = await realClinician();
    const { service, rows } = buildService(clinician);
    const { refreshToken } = await service.login("drchen", "correct-password-123");
    clinician.deactivatedAt = new Date();

    await expect(service.refresh(refreshToken)).rejects.toThrow("not active");
    expect(rows[0]!.revokedReason).toBe("account_inactive");
  });
});

describe("AuthService revocation", () => {
  it("logout revokes the whole family, so a rotated-away token cannot come back", async () => {
    const { service, rows } = buildService(await realClinician());
    const first = await service.login("drchen", "correct-password-123");
    const second = await service.refresh(first.refreshToken);

    await service.logout(second.refreshToken);

    expect(rows.every((r) => r.revokedAt)).toBe(true);
    await expect(service.refresh(second.refreshToken)).rejects.toThrow(UnauthorizedException);
  });

  it("logout is silent for an unknown or missing token", async () => {
    const { service } = buildService(await realClinician());
    await expect(service.logout("nope")).resolves.toBeUndefined();
    await expect(service.logout(undefined as never)).resolves.toBeUndefined();
  });

  it("revokeAllForClinician ends every session (password change, deactivation)", async () => {
    const { service, rows } = buildService(await realClinician());
    const a = await service.login("drchen", "correct-password-123");
    const b = await service.login("drchen", "correct-password-123");

    const count = await service.revokeAllForClinician("c1", "password_changed");

    expect(count).toBe(2);
    expect(rows.map((r) => r.revokedReason)).toEqual(["password_changed", "password_changed"]);
    await expect(service.refresh(a.refreshToken)).rejects.toThrow(UnauthorizedException);
    await expect(service.refresh(b.refreshToken)).rejects.toThrow(UnauthorizedException);
  });

  it("one login's logout does not end another device's session", async () => {
    const { service } = buildService(await realClinician());
    const phone = await service.login("drchen", "correct-password-123");
    const tablet = await service.login("drchen", "correct-password-123");

    await service.logout(phone.refreshToken);

    await expect(service.refresh(tablet.refreshToken)).resolves.toBeDefined();
  });
});
