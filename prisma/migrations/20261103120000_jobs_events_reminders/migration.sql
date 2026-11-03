-- DropIndex
DROP INDEX "Checkpoint_invoiceId_key";

-- AlterTable
ALTER TABLE "Checkpoint" DROP COLUMN "graphState",
DROP COLUMN "invoiceId",
ADD COLUMN     "decidedBy" TEXT,
ADD COLUMN     "decision" TEXT,
ADD COLUMN     "jobId" TEXT NOT NULL,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "snapshot" JSONB;

-- AlterTable
ALTER TABLE "ExtractedInvoice" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "vendorEmail" TEXT;

-- AlterTable
ALTER TABLE "TenantConfig" ADD COLUMN     "reminderOffsetsDays" INTEGER[] DEFAULT ARRAY[-3, 0, 7]::INTEGER[],
ADD COLUMN     "reminderRecipients" TEXT[],
ADD COLUMN     "remindersEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "fileName" TEXT,
    "filePath" TEXT,
    "mimeType" TEXT,
    "contentHash" TEXT NOT NULL,
    "externalId" TEXT,
    "emailFrom" TEXT,
    "emailSubject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "currentNode" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "extractedJson" JSONB,
    "errors" JSONB,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEvent" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "node" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "outcome" TEXT,
    "message" TEXT,
    "durationMs" INTEGER,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipients" TEXT[],
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "historyId" TEXT,
    "deltaLink" TEXT,
    "watchExpiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "canSend" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailboxConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionJob_invoiceId_key" ON "IngestionJob"("invoiceId");

-- CreateIndex
CREATE INDEX "IngestionJob_orgId_status_idx" ON "IngestionJob"("orgId", "status");

-- CreateIndex
CREATE INDEX "IngestionJob_orgId_createdAt_idx" ON "IngestionJob"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionJob_orgId_contentHash_key" ON "IngestionJob"("orgId", "contentHash");

-- CreateIndex
CREATE INDEX "AgentEvent_jobId_createdAt_idx" ON "AgentEvent"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentEvent_orgId_createdAt_idx" ON "AgentEvent"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "Reminder_orgId_createdAt_idx" ON "Reminder"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_invoiceId_offsetDays_key" ON "Reminder"("invoiceId", "offsetDays");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxConnection_orgId_key" ON "MailboxConnection"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Checkpoint_jobId_key" ON "Checkpoint"("jobId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionJob" ADD CONSTRAINT "IngestionJob_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionJob" ADD CONSTRAINT "IngestionJob_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ExtractedInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "IngestionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ExtractedInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxConnection" ADD CONSTRAINT "MailboxConnection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

