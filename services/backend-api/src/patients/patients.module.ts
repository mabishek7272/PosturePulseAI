import { Module } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { PatientCrypto } from "./patient-crypto";
import { PatientErasureService } from "./patient-erasure.service";
import { PatientsController } from "./patients.controller";
import { PatientsService } from "./patients.service";

/**
 * The patient register (ADR-017). The crypto provider is built from
 * PATIENT_DATA_KEY when the module is created, so a missing or malformed key
 * stops the application from starting rather than failing on the first request.
 */
@Module({
  controllers: [PatientsController],
  providers: [PrismaService, { provide: PatientCrypto, useFactory: () => PatientCrypto.fromEnv() }, PatientsService, { provide: PatientErasureService, useFactory: (prisma: PrismaService, crypto: PatientCrypto) => new PatientErasureService(prisma, crypto), inject: [PrismaService, PatientCrypto] }],
})
export class PatientsModule {}
