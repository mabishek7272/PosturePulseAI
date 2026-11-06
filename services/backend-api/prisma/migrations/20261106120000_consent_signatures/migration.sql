-- Optional sealed patient + clinician signatures on a consent record.
-- Nullable: every existing record was granted before signatures were captured.
ALTER TABLE "ConsentRecord" ADD COLUMN "signaturesEnc" TEXT;
