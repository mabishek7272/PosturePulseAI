-- CreateTable
CREATE TABLE "AuditLogEntry" (
    "id" TEXT NOT NULL,
    "clinicianId" TEXT NOT NULL,
    "clinicianUsername" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "sessionId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLogEntry_sessionId_occurredAt_idx" ON "AuditLogEntry"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLogEntry_clinicianId_occurredAt_idx" ON "AuditLogEntry"("clinicianId", "occurredAt");
