import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";

interface LoginBody {
  username: string;
  password: string;
}

interface RefreshBody {
  refreshToken: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Public: username + password in, access token + 30-day refresh token out. */
  @Post("login")
  login(@Body() body: LoginBody) {
    return this.auth.login(body.username, body.password);
  }

  /** Public (the refresh token is the credential): rotates it and returns a fresh pair. */
  @Post("refresh")
  @HttpCode(200)
  refresh(@Body() body: RefreshBody) {
    return this.auth.refresh(body?.refreshToken);
  }

  /** Public and idempotent: ends the session the refresh token belongs to. */
  @Post("logout")
  @HttpCode(204)
  async logout(@Body() body: RefreshBody): Promise<void> {
    await this.auth.logout(body?.refreshToken);
  }
}
