import { Module } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { PatientCrypto } from "../patients/patient-crypto";
import { ClinicianProfileController } from "./clinician-profile.controller";
import { ClinicianProfileService } from "./clinician-profile.service";

/** Built from PATIENT_DATA_KEY like the patient register: the signature is sealed with the same key. */
@Module({
  controllers: [ClinicianProfileController],
  providers: [PrismaService, { provide: PatientCrypto, useFactory: () => PatientCrypto.fromEnv() }, ClinicianProfileService],
  exports: [ClinicianProfileService],
})
export class CliniciansModule {}
