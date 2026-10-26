import { Body, Controller, Post } from "@nestjs/common";
import { PatientAuthService } from "./patient-auth.service";

interface EmailPasswordBody {
  email: string;
  password: string;
}

/** Both routes are intentionally public (no JwtAuthGuard) - a patient has no
 * token yet when signing up or logging in, same as AuthController's /login. */
@Controller("auth/patient")
export class PatientAuthController {
  constructor(private readonly auth: PatientAuthService) {}

  @Post("signup")
  signup(@Body() body: EmailPasswordBody) {
    return this.auth.signup(body.email, body.password);
  }

  @Post("login")
  login(@Body() body: EmailPasswordBody) {
    return this.auth.login(body.email, body.password);
  }
}
