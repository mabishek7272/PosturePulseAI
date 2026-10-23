-- CreateTable
CREATE TABLE "Clip" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sidecar" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisJob" (
    "id" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentReport" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "reportVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "signedBy" TEXT,
    "signedAt" TIMESTAMP(3),
    "contentSha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "nameEnc" TEXT NOT NULL,
    "dobEnc" TEXT NOT NULL,
    "contactEnc" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientSubjectLink" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "subjectPseudoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientSubjectLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Clip_sessionId_stepId_createdAt_idx" ON "Clip"("sessionId", "stepId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisJob_clipId_key" ON "AnalysisJob"("clipId");

-- CreateIndex
CREATE INDEX "AnalysisJob_status_createdAt_idx" ON "AnalysisJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AssessmentReport_status_createdAt_idx" ON "AssessmentReport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentReport_sessionId_reportVersion_key" ON "AssessmentReport"("sessionId", "reportVersion");

-- CreateIndex
CREATE UNIQUE INDEX "PatientSubjectLink_subjectPseudoId_key" ON "PatientSubjectLink"("subjectPseudoId");

-- CreateIndex
CREATE INDEX "PatientSubjectLink_patientId_idx" ON "PatientSubjectLink"("patientId");

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisJob" ADD CONSTRAINT "AnalysisJob_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentReport" ADD CONSTRAINT "AssessmentReport_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientSubjectLink" ADD CONSTRAINT "PatientSubjectLink_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

