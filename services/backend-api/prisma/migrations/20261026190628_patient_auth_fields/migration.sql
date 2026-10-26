-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "email" TEXT,
ADD COLUMN     "passwordHash" TEXT,
ALTER COLUMN "nameEnc" DROP NOT NULL,
ALTER COLUMN "dobEnc" DROP NOT NULL,
ALTER COLUMN "createdBy" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Patient_email_key" ON "Patient"("email");

