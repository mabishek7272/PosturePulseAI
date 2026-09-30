-- CreateTable
CREATE TABLE "AdverseEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "subjectPseudoId" TEXT NOT NULL,
    "reportedByClinicianId" TEXT NOT NULL,
    "relatedSymptomReportId" TEXT,
    "onsetAt" TIMESTAMP(3) NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "serious" BOOLEAN NOT NULL,
    "causality" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "actionTaken" TEXT NOT NULL,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "reportedToEthicsBoardAt" TIMESTAMP(3),

    CONSTRAINT "AdverseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdverseEvent_subjectPseudoId_reportedAt_idx" ON "AdverseEvent"("subjectPseudoId", "reportedAt");

-- CreateIndex
CREATE INDEX "AdverseEvent_sessionId_idx" ON "AdverseEvent"("sessionId");

-- CreateIndex
CREATE INDEX "AdverseEvent_serious_reportedAt_idx" ON "AdverseEvent"("serious", "reportedAt");
