-- Clinician professional profile, deactivation, refresh tokens, patient registrar snapshot.
ALTER TABLE "Clinician"
  ADD COLUMN "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN "fullName" TEXT,
  ADD COLUMN "specialty" TEXT,
  ADD COLUMN "licenceNumber" TEXT,
  ADD COLUMN "qualifications" TEXT,
  ADD COLUMN "licensingAuthority" TEXT,
  ADD COLUMN "clinic" TEXT,
  ADD COLUMN "professionalContact" TEXT,
  ADD COLUMN "signatureEnc" TEXT,
  ADD COLUMN "profileUpdatedAt" TIMESTAMP(3);

CREATE TABLE "RefreshToken" (
  "id" TEXT NOT NULL,
  "clinicianId" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "revokedReason" TEXT,
  "replacedById" TEXT,
  CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_clinicianId_idx" ON "RefreshToken"("clinicianId");
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_clinicianId_fkey"
  FOREIGN KEY ("clinicianId") REFERENCES "Clinician"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Patient" ADD COLUMN "registrarSnapshot" JSONB;
