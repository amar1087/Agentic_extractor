// src/agent/nodes/verify.ts
// PURPOSE: Duplicate check (validation rule 3), tenant policy checks, and the
// vendor whitelist (FR-05). TenantConfig has individual typed fields.

import { prisma } from "../../db/client.js";
import { AgentStateType } from "../state.js";

export async function verifyNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  if (!state.extracted) {
    return { status: "VERIFY_SKIPPED", errors: ["No extracted invoice to verify"] };
  }

  const { vendor, invoiceMeta } = state.extracted;

  try {
    // ── Rule 3: invoice ID uniqueness per org ────────────────────────────────
    const existing = await prisma.extractedInvoice.findUnique({
      where: { orgId_invoiceRef: { orgId: state.orgId, invoiceRef: invoiceMeta.invoiceId } },
      include: { job: { select: { id: true } } },
    });
    if (existing && existing.job?.id !== state.jobId) {
      return {
        status: "DUPLICATE",
        errors: [`Invoice ${invoiceMeta.invoiceId} was already processed (${existing.vendorName})`],
        note: `Duplicate of an invoice already in the ledger`,
      };
    }

    const tenantConfig = await prisma.tenantConfig.findUnique({ where: { orgId: state.orgId } });

    // ── Tenant policies ──────────────────────────────────────────────────────
    const policyErrors: string[] = [];
    if (tenantConfig?.requireVendorTaxId && !vendor.taxId) {
      policyErrors.push(`Vendor "${vendor.name}" has no Tax ID, which your org requires`);
    }
    if (tenantConfig?.requireDueDate && !invoiceMeta.dueDate) {
      policyErrors.push("Invoice has no due date, which your org requires");
    }
    const supported = tenantConfig?.supportedCurrencies ?? [];
    if (supported.length > 0 && !supported.includes(invoiceMeta.currency)) {
      policyErrors.push(`Currency ${invoiceMeta.currency} is not in your supported currencies (${supported.join(", ")})`);
    }
    if (policyErrors.length > 0) {
      return { status: "POLICY_FAILED", reviewReason: "POLICY", errors: policyErrors, note: policyErrors[0] };
    }

    // ── Vendor whitelist ─────────────────────────────────────────────────────
    if (tenantConfig?.autoVerifyVendors === true) {
      return { status: "VENDOR_KNOWN", errors: [], note: "Auto-verify is on — whitelist check skipped" };
    }

    const whitelisted = await prisma.vendorWhitelist.findFirst({
      where: { orgId: state.orgId, vendorName: { equals: vendor.name, mode: "insensitive" } },
    });
    if (whitelisted) {
      // Store under the whitelist's spelling so "ACME CORP" and "Acme Corp" group together
      return {
        status: "VENDOR_KNOWN",
        errors: [],
        extracted: { ...state.extracted, vendor: { ...vendor, name: whitelisted.vendorName } },
        note: `"${whitelisted.vendorName}" is an approved vendor`,
      };
    }

    return {
      status: "VENDOR_UNKNOWN",
      reviewReason: "UNKNOWN_VENDOR",
      errors: [`Vendor "${vendor.name}" is not in your approved vendor whitelist`],
      note: `"${vendor.name}" is not whitelisted — needs a human`,
    };
  } catch (err: any) {
    return { status: "VERIFY_FAILED", errors: [`VERIFY error: ${err.message}`], note: err.message };
  }
}
