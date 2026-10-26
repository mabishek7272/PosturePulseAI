import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../common/prisma.service";
import type { JwtPayload } from "./auth.service";

const BCRYPT_SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 12;
// A deliberately liberal syntax check (allows +tags etc.), not a
// deliverability check - there's no verification-email flow yet.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Real patient self-signup/login (docs/adr/019-patient-self-signup.md,
 * superseding ADR-012's "no subject accounts"). Mirrors AuthService
 * (clinician) exactly: bcrypt, constant-time compare, JWT. The existing
 * pseudonymous SubjectAuthService flow is untouched and still works for
 * anything not yet migrated to this login.
 */
@Injectable()
export class PatientAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService
  ) {}

  async signup(email: string, password: string): Promise<{ accessToken: string }> {
    this.validate(email, password);
    const existing = await this.prisma.patient.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException("An account with that email already exists.");
    }
    const passwordHash = await PatientAuthService.hashPassword(password);
    const patient = await this.prisma.patient.create({ data: { email, passwordHash } });
    return this.issue(patient.id, email);
  }

  async login(email: string, password: string): Promise<{ accessToken: string }> {
    const patient = await this.prisma.patient.findUnique({ where: { email } });
    // Compare against a fixed dummy hash when the email doesn't exist, so this
    // path takes roughly the same time as a real mismatch - mirrors AuthService.
    const passwordHash = patient?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali";
    const passwordMatches = await bcrypt.compare(password, passwordHash);

    if (!patient || !passwordMatches) {
      throw new UnauthorizedException("Invalid email or password");
    }

    return this.issue(patient.id, email);
  }

  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  }

  private validate(email: string, password: string): void {
    if (typeof email !== "string" || !EMAIL_PATTERN.test(email)) {
      throw new BadRequestException("A valid email is required.");
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
  }

  private async issue(sub: string, email: string): Promise<{ accessToken: string }> {
    const payload: JwtPayload = { sub, email, role: "patient" };
    return { accessToken: await this.jwt.signAsync(payload) };
  }
}
