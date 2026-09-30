import { Global, Logger, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaService } from "../common/prisma.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RolesGuard } from "./roles.guard";

const DEV_ONLY_JWT_SECRET_FALLBACK = "dev-only-insecure-secret-do-not-use-in-any-shared-environment";

function resolveJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  new Logger("AuthModule").warn(
    "JWT_SECRET is not set - falling back to a hardcoded, publicly-known dev secret. " +
      "Tokens issued this way must never be trusted outside local development."
  );
  return DEV_ONLY_JWT_SECRET_FALLBACK;
}

// Global so JwtAuthGuard/RolesGuard's own JwtService dependency resolves
// wherever a controller applies @UseGuards(JwtAuthGuard, RolesGuard) -
// without this, each importing module would need JwtModule re-registered
// in its own DI context to satisfy JwtAuthGuard's constructor.
@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: resolveJwtSecret(),
      signOptions: { expiresIn: "8h" },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PrismaService, JwtAuthGuard, RolesGuard],
  exports: [JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
