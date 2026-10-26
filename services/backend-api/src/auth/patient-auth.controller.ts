import { Body, Controller, Post } from "@nestjs/common";
import { PatientAuthService } from "./patient-auth.service";

interface SignupBody {
  email: string;
  password: string;
}

@Controller("auth/patient")
export class PatientAuthController {
  constructor(private readonly auth: PatientAuthService) {}

  @Post("signup")
  signup(@Body() body: SignupBody) {
    return this.auth.signup(body.email, body.password);
  }

  @Post("login")
  login(@Body() body: SignupBody) {
    return this.auth.login(body.email, body.password);
  }
}
