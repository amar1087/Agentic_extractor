-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "billingEmail" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedInvoice" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "vendorTaxId" TEXT,
    "invoiceRef" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "currency" TEXT,
    "subtotalCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "grandTotalCents" INTEGER NOT NULL,
    "lineItemsJson" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorLog" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractedInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorWhitelist" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "taxId" TEXT,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT NOT NULL,

    CONSTRAINT "VendorWhitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "autoVerifyVendors" BOOLEAN NOT NULL DEFAULT false,
    "requireVendorTaxId" BOOLEAN NOT NULL DEFAULT false,
    "reviewTimeoutHours" INTEGER NOT NULL DEFAULT 72,
    "reviewerEmails" TEXT[],
    "reviewWebhookUrl" TEXT,
    "maxRetries" INTEGER NOT NULL DEFAULT 2,
    "defaultCurrency" TEXT,
    "supportedCurrencies" TEXT[],
    "retentionDays" INTEGER NOT NULL DEFAULT 2555,
    "requireDueDate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TenantConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checkpoint" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "graphState" BYTEA NOT NULL,
    "nodeAt" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Checkpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExtractedInvoice_orgId_status_idx" ON "ExtractedInvoice"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractedInvoice_orgId_invoiceRef_key" ON "ExtractedInvoice"("orgId", "invoiceRef");

-- CreateIndex
CREATE INDEX "VendorWhitelist_orgId_idx" ON "VendorWhitelist"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorWhitelist_orgId_vendorName_key" ON "VendorWhitelist"("orgId", "vendorName");

-- CreateIndex
CREATE UNIQUE INDEX "TenantConfig_orgId_key" ON "TenantConfig"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Checkpoint_invoiceId_key" ON "Checkpoint"("invoiceId");

-- AddForeignKey
ALTER TABLE "ExtractedInvoice" ADD CONSTRAINT "ExtractedInvoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorWhitelist" ADD CONSTRAINT "VendorWhitelist_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantConfig" ADD CONSTRAINT "TenantConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkpoint" ADD CONSTRAINT "Checkpoint_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
