import { Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";

interface LoginBody {
  username: string;
  password: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** The only public auth route - everything else under this controller (if anything is added later) should require a valid token. */
  @Post("login")
  login(@Body() body: LoginBody) {
    return this.auth.login(body.username, body.password);
  }
}
