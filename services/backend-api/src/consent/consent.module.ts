import { Module } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { ConsentController } from "./consent.controller";
import { ConsentService } from "./consent.service";

@Module({
  controllers: [ConsentController],
  providers: [ConsentService, PrismaService],
  exports: [ConsentService],
})
export class ConsentModule {}
