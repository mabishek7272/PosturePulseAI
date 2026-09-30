import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { JwtPayload } from "./auth.service";

/**
 * Verifies the `Authorization: Bearer <token>` header and attaches the
 * decoded payload to `request.user`, so RolesGuard can check a real,
 * server-verified role instead of a trusted client-supplied header
 * (docs/adr/010-clinician-authentication.md). Apply alongside RolesGuard
 * (@UseGuards(JwtAuthGuard, RolesGuard)) - RolesGuard alone does nothing
 * without this guard having populated request.user first.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers["authorization"];
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    try {
      request.user = await this.jwt.verifyAsync<JwtPayload>(token);
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
