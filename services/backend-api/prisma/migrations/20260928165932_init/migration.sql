-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "subjectPseudoId" TEXT NOT NULL,
    "protocolId" TEXT NOT NULL,
    "protocolVersion" TEXT NOT NULL,
    "deploymentContext" TEXT NOT NULL,
    "consentRecordId" TEXT NOT NULL,
    "retentionPolicy" JSONB NOT NULL,
    "calibrationRef" TEXT,
    "state" TEXT NOT NULL,
    "safetySnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "schemaId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtocolVersion" (
    "id" TEXT NOT NULL,
    "protocolKey" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProtocolVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_subjectPseudoId_idx" ON "Session"("subjectPseudoId");

-- CreateIndex
CREATE INDEX "Event_sessionId_createdAt_idx" ON "Event"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProtocolVersion_protocolKey_version_key" ON "ProtocolVersion"("protocolKey", "version");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
