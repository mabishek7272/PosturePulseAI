import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { ClinicianProfileInput, ClinicianProfileService } from "./clinician-profile.service";

/** A clinician's own professional profile. There is no way to read or write anyone else's. */
@Controller("clinicians/me")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("clinician")
export class ClinicianProfileController {
  constructor(private readonly profiles: ClinicianProfileService) {}

  @Get("profile")
  get(@Req() req: { user: { sub: string } }) {
    return this.profiles.get(req.user.sub);
  }

  @Put("profile")
  update(@Body() body: ClinicianProfileInput, @Req() req: { user: { sub: string } }) {
    return this.profiles.update(req.user.sub, body);
  }
}
