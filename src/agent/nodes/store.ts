// src/agent/nodes/store.ts
// PURPOSE: Saves the validated (or human-approved) invoice to PostgreSQL.
// All monetary values stored as INTEGER CENTS via Decimal (NFR-03).

import { prisma } from "../../db/client.js";
import { toCents } from "../../lib/money.js";
import { AgentStateType } from "../state.js";

export async function storeNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  if (!state.extracted) {
    return { status: "STORE_FAILED", errors: ["No extracted invoice to store"] };
  }

  const invoice = state.extracted;
  const job = await prisma.ingestionJob.findUnique({ where: { id: state.jobId } });

  const data = {
    s3Key: job?.filePath ?? `inline/${state.jobId}`,
    sourceType: state.sourceType,
    vendorName: invoice.vendor.name,
    vendorTaxId: invoice.vendor.taxId ?? null,
    vendorEmail: invoice.vendor.email ?? null,
    issueDate: new Date(invoice.invoiceMeta.issueDate),
    dueDate: invoice.invoiceMeta.dueDate ? new Date(invoice.invoiceMeta.dueDate) : null,
    currency: invoice.invoiceMeta.currency,
    subtotalCents: toCents(invoice.totals.subtotal),
    taxCents: toCents(invoice.totals.tax),
    grandTotalCents: toCents(invoice.totals.grandTotal),
    lineItemsJson: invoice.items,
    status: "COMPLETE",
    retryCount: state.retryCount,
    errorLog: state.decision ? { approvedBy: state.decision.decidedBy, action: state.decision.action } : undefined,
  };

  try {
    // The job may already own a ledger row if it was resumed after a crash
    const saved = job?.invoiceId
      ? await prisma.extractedInvoice.update({ where: { id: job.invoiceId }, data })
      : await prisma.extractedInvoice.create({
          data: { ...data, orgId: state.orgId, invoiceRef: invoice.invoiceMeta.invoiceId },
        });

    await prisma.ingestionJob.update({ where: { id: state.jobId }, data: { invoiceId: saved.id } });

    return {
      invoiceId: saved.id,
      status: "COMPLETED",
      errors: [],
      note: `Saved to ledger · ${invoice.invoiceMeta.currency} ${invoice.totals.grandTotal} due ${invoice.invoiceMeta.dueDate ?? "—"}`,
    };
  } catch (err: any) {
    if (err.code === "P2002") {
      // Another job stored the same invoice ref between VERIFY and here
      return {
        status: "DUPLICATE",
        errors: [`Invoice ${invoice.invoiceMeta.invoiceId} was stored by another job`],
        note: "Duplicate (race) — already in the ledger",
      };
    }
    return { status: "STORE_FAILED", errors: [`STORE error: ${err.message}`], note: err.message };
  }
}
