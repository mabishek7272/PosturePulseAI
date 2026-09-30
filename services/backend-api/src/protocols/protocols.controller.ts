import { Controller, Get, Param } from "@nestjs/common";
import { ProtocolsService } from "./protocols.service";

@Controller("protocols")
export class ProtocolsController {
  constructor(private readonly protocols: ProtocolsService) {}

  @Get()
  list() {
    return this.protocols.listAll();
  }

  @Get(":protocolKey/:version")
  get(@Param("protocolKey") protocolKey: string, @Param("version") version: string) {
    return this.protocols.get(protocolKey, version);
  }
}
