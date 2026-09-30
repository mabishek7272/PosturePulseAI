import { Module } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { ProtocolsController } from "./protocols.controller";
import { ProtocolsService } from "./protocols.service";

@Module({
  controllers: [ProtocolsController],
  providers: [ProtocolsService, PrismaService],
  exports: [ProtocolsService],
})
export class ProtocolsModule {}
