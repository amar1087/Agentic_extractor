// src/agent/nodes/hitl.ts
// PURPOSE: Human In The Loop — pauses the graph when:
//   1. Vendor is unknown (UNKNOWN_VENDOR)
//   2. AI failed after max retries (VALIDATION_EXHAUSTED)
//   3. A tenant policy failed (POLICY)
//
// Uses LangGraph's interrupt(): the graph state is checkpointed by the
// PostgresSaver and execution stops here. POST /api/review/:jobId/decision
// resumes the same thread with Command({ resume: decision }), and this node
// re-runs from the top — so everything before interrupt() must be idempotent.

import { Command, interrupt } from "@langchain/langgraph";
import { prisma } from "../../db/client.js";
import { updateJob } from "../../events/bus.js";
import { AgentStateType, ReviewDecision, ReviewReason } from "../state.js";

function determineReason(state: AgentStateType): ReviewReason {
  if (state.reviewReason) return state.reviewReason;
  if (state.status === "VENDOR_UNKNOWN") return "UNKNOWN_VENDOR";
  return "VALIDATION_EXHAUSTED";
}

export async function hitlNode(state: AgentStateType) {
  const reason = determineReason(state);

  // ── Step 1: Record the escalation (once per escalation) ────────────────────
  const existing = await prisma.checkpoint.findUnique({ where: { jobId: state.jobId } });
  if (!existing || existing.resolvedAt) {
    const tenantConfig = await prisma.tenantConfig.findUnique({ where: { orgId: state.orgId } });
    const timeoutHours = tenantConfig?.reviewTimeoutHours ?? 72;
    const expiresAt = new Date(Date.now() + timeoutHours * 60 * 60 * 1000);
    const snapshot = { extracted: state.extracted, errors: state.errors, retryCount: state.retryCount };

    await prisma.checkpoint.upsert({
      where: { jobId: state.jobId },
      update: { snapshot: snapshot as any, nodeAt: "HUMAN_REVIEW", reason, expiresAt, resolvedAt: null, decision: null, decidedBy: null },
      create: { jobId: state.jobId, orgId: state.orgId, snapshot: snapshot as any, nodeAt: "HUMAN_REVIEW", reason, expiresAt },
    });
    await updateJob(state.jobId, {
      status: "AWAITING_REVIEW",
      currentNode: "HUMAN_REVIEW",
      extractedJson: (state.extracted ?? undefined) as any,
      errors: state.errors,
    });
    await notifyReviewers({
      emails: tenantConfig?.reviewerEmails ?? [],
      webhookUrl: tenantConfig?.reviewWebhookUrl ?? null,
      orgId: state.orgId,
      jobId: state.jobId,
      reason,
      errors: state.errors,
      expiresAt,
    });
  }

  // ── Step 2: Pause until a reviewer decides ──────────────────────────────────
  const decision = interrupt<unknown, ReviewDecision>({ reason, errors: state.errors, extracted: state.extracted });

  // ── Step 3: Resumed — act on the decision ───────────────────────────────────
  await prisma.checkpoint.update({
    where: { jobId: state.jobId },
    data: { resolvedAt: new Date(), decision: decision.action, decidedBy: decision.decidedBy },
  });

  const extracted = decision.corrected ?? state.extracted;
  const base = { decision, reviewReason: null, extracted, errors: [] as string[] };

  if (decision.action === "REJECT" || !extracted) {
    return new Command({
      goto: "REJECTED",
      update: {
        ...base,
        status: "REJECTED",
        errors: [decision.reason || (extracted ? "Rejected by reviewer" : "Rejected — nothing could be extracted")],
        note: `Rejected by ${decision.decidedBy}${decision.reason ? `: ${decision.reason}` : ""}`,
      },
    });
  }

  if (decision.action === "APPROVE_AND_WHITELIST") {
    await prisma.vendorWhitelist.upsert({
      where: { orgId_vendorName: { orgId: state.orgId, vendorName: extracted.vendor.name } },
      update: {},
      create: {
        orgId: state.orgId,
        vendorName: extracted.vendor.name,
        taxId: extracted.vendor.taxId ?? null,
        approvedBy: decision.decidedBy,
      },
    });
    // Re-run verification so duplicate / policy checks still apply
    return new Command({
      goto: "VERIFY",
      update: { ...base, status: "WHITELISTED", note: `${decision.decidedBy} approved and whitelisted "${extracted.vendor.name}"` },
    });
  }

  // Escalations that happened before VERIFY (bad numbers, unreadable input) have
  // not been through the duplicate / whitelist checks yet — send them there first.
  const verified = reason === "UNKNOWN_VENDOR" || reason === "POLICY";
  return new Command({
    goto: verified ? "STORE" : "VERIFY",
    update: { ...base, status: "APPROVED", note: `Approved by ${decision.decidedBy}${decision.corrected ? " with corrections" : ""}` },
  });
}

async function notifyReviewers(params: {
  emails: string[];
  webhookUrl: string | null;
  orgId: string;
  jobId: string;
  reason: string;
  errors: string[];
  expiresAt: Date;
}) {
  const { emails, webhookUrl, orgId, jobId, reason, errors, expiresAt } = params;
  if (emails.length === 0 && !webhookUrl) return;

  const reviewUrl = `${process.env.APP_URL ?? "http://localhost:5173"}/review/${jobId}`;
  const payload = {
    orgId, jobId, reason, errors, reviewUrl,
    expiresAt: expiresAt.toISOString(),
    message: reason === "UNKNOWN_VENDOR"
      ? `Invoice from unknown vendor requires approval. Review by ${expiresAt.toLocaleDateString()}.`
      : `Invoice needs manual review (${reason}). Review by ${expiresAt.toLocaleDateString()}.`,
  };

  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err: any) {
      console.warn(`Webhook notification failed: ${err.message}`);
    }
  }

  if (emails.length > 0) {
    const { sendMail } = await import("../../reminders/mailer.js");
    await sendMail(orgId, {
      to: emails,
      subject: `[Review needed] ${reason.replace("_", " ").toLowerCase()} — invoice awaiting approval`,
      body: `${payload.message}\n\n${errors.map((e) => `• ${e}`).join("\n")}\n\nReview it here: ${reviewUrl}`,
    }).catch((err) => console.warn(`Reviewer email failed: ${err.message}`));
  }
}
