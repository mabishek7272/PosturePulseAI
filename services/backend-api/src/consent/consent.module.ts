import { Module } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { PatientCrypto } from "../patients/patient-crypto";
import { ConsentSignaturesService } from "./consent-signatures.service";
import { ConsentController } from "./consent.controller";
import { ConsentService } from "./consent.service";

@Module({
  controllers: [ConsentController],
  providers: [
    ConsentService,
    ConsentSignaturesService,
    PrismaService,
    // Same key as the patient register: signatures identify a person (ADR-017).
    { provide: PatientCrypto, useFactory: () => PatientCrypto.fromEnv() },
  ],
  exports: [ConsentService],
})
export class ConsentModule {}
