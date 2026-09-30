import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ConsentService, CreateConsentRecordInput } from "./consent.service";

@Controller("consent-records")
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Post()
  create(@Body() body: CreateConsentRecordInput) {
    return this.consent.create(body);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.consent.get(id);
  }
}
