// src/reminders/agent.ts
// PURPOSE: The collections / reminder agent. Scans unpaid invoices in the
// ledger, decides which reminder stage applies (relative to the due date),
// has the model draft the email with an escalating tone, and sends it.
//
// Stages come from TenantConfig.reminderOffsetsDays, e.g. [-3, 0, 7]:
//   -3 → "due in 3 days", 0 → "due today", 7 → "a week overdue".
// Only the latest stage that applies is sent, and each stage at most once
// per invoice (@@unique([invoiceId, offsetDays])).

import { z } from "zod";
import { prisma } from "../db/client.js";
import { publish } from "../events/bus.js";
import { formatMoney } from "../lib/money.js";
import { chatJSON } from "../llm/client.js";
import { sendMail } from "./mailer.js";

const DAY = 86_400_000;

const DraftSchema = z.object({ subject: z.string().min(3), body: z.string().min(20) });
const DraftJSONSchema = {
  type: "object",
  properties: { subject: { type: "string" }, body: { type: "string" } },
  required: ["subject", "body"],
};

type InvoiceRow = Awaited<ReturnType<typeof prisma.extractedInvoice.findFirstOrThrow>>;

export function daysFromDue(dueDate: Date, now = new Date()) {
  const due = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - due) / DAY); // positive = overdue
}

export function kindFor(offset: number) {
  return offset < 0 ? "UPCOMING" : offset === 0 ? "DUE_TODAY" : "OVERDUE";
}

function describeTiming(days: number) {
  if (days < 0) return `due in ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return "due today";
  return `${days} day${days === 1 ? "" : "s"} overdue`;
}

function fallbackDraft(inv: InvoiceRow, days: number) {
  const amount = formatMoney(inv.grandTotalCents, inv.currency ?? "USD");
  const due = inv.dueDate!.toISOString().slice(0, 10);
  const urgency = days > 0 ? "OVERDUE: " : days === 0 ? "Due today: " : "Upcoming: ";
  return {
    subject: `${urgency}${inv.vendorName} invoice ${inv.invoiceRef} — ${amount}`,
    body: `Hi team,\n\nInvoice ${inv.invoiceRef} from ${inv.vendorName} for ${amount} is ${describeTiming(days)} (due ${due}).\n\n` +
      (days > 0 ? "Please arrange payment as soon as possible to avoid late fees and supplier holds.\n\n" : "Please schedule payment before the due date.\n\n") +
      "— Agentic Extractor",
  };
}

async function draftReminder(inv: InvoiceRow, days: number, orgName: string) {
  const amount = formatMoney(inv.grandTotalCents, inv.currency ?? "USD");
  try {
    const json = await chatJSON({
      system: "You write short, professional accounts-payable reminder emails for a finance team. Plain text, no markdown, under 120 words.",
      prompt: `Write a payment reminder to the internal finance team at ${orgName}.
Invoice: ${inv.invoiceRef} from vendor ${inv.vendorName}
Amount: ${amount}
Due date: ${inv.dueDate!.toISOString().slice(0, 10)} (${describeTiming(days)})
Tone: ${days < 0 ? "friendly heads-up" : days === 0 ? "clear and direct" : days > 14 ? "urgent — escalation, mention risk of late fees and supplier hold" : "firm"}
Format the body as a real email: a greeting line ("Hi team,"), one or two short paragraphs
stating the vendor, invoice number, amount and due date and what action is needed, then
a sign-off on its own line ("— Agentic Extractor"). Separate paragraphs with blank lines.
Return JSON with "subject" and "body".`,
      schema: DraftJSONSchema,
      temperature: 0.4,
    });
    return { ...DraftSchema.parse(json), drafter: "llm" as const };
  } catch (err: any) {
    console.warn(`Reminder draft fell back to template for ${inv.invoiceRef}: ${err.message}`);
    return { ...fallbackDraft(inv, days), drafter: "template" as const };
  }
}

async function recipientsFor(orgId: string) {
  const [cfg, org] = await Promise.all([
    prisma.tenantConfig.findUnique({ where: { orgId } }),
    prisma.organization.findUniqueOrThrow({ where: { id: orgId } }),
  ]);
  return { cfg, org, to: cfg?.reminderRecipients?.length ? cfg.reminderRecipients : [org.billingEmail] };
}

async function deliver(inv: InvoiceRow, offsetDays: number, days: number) {
  const { org, to } = await recipientsFor(inv.orgId);
  const draft = await draftReminder(inv, days, org.name);

  let channel = "PREVIEW", status = "DRAFTED", error: string | null = null;
  try {
    const sent = await sendMail(inv.orgId, { to, subject: draft.subject, body: draft.body });
    channel = sent.channel;
    status = sent.status;
  } catch (err: any) {
    status = "FAILED";
    error = err.message;
  }

  const reminder = await prisma.reminder.create({
    data: {
      orgId: inv.orgId, invoiceId: inv.id, offsetDays, kind: kindFor(offsetDays),
      channel, recipients: to, subject: draft.subject, body: draft.body, status, error,
    },
  });
  publish({ type: "reminder-sent", orgId: inv.orgId, reminderId: reminder.id, invoiceId: inv.id });
  return reminder;
}

export async function runReminderAgent(orgId?: string, now = new Date()) {
  const orgs = orgId ? [{ id: orgId }] : await prisma.organization.findMany({ select: { id: true } });
  const results: { invoiceId: string; offsetDays: number; status: string }[] = [];

  for (const { id } of orgs) {
    const cfg = await prisma.tenantConfig.findUnique({ where: { orgId: id } });
    if (cfg && !cfg.remindersEnabled) continue;
    const offsets = [...(cfg?.reminderOffsetsDays?.length ? cfg.reminderOffsetsDays : [-3, 0, 7])].sort((a, b) => a - b);

    const invoices = await prisma.extractedInvoice.findMany({
      where: { orgId: id, status: "COMPLETE", paymentStatus: "UNPAID", dueDate: { not: null } },
      include: { reminders: { select: { offsetDays: true } } },
    });

    for (const inv of invoices) {
      const days = daysFromDue(inv.dueDate!, now);
      const stage = offsets.filter((o) => o <= days).pop();
      if (stage === undefined) continue;
      // Skip if this stage — or a later one — has already gone out
      if (inv.reminders.some((r) => r.offsetDays >= stage)) continue;
      try {
        const r = await deliver(inv, stage, days);
        results.push({ invoiceId: inv.id, offsetDays: stage, status: r.status });
      } catch (err: any) {
        if (err.code !== "P2002") throw err; // a concurrent run already sent this stage
      }
    }
  }
  return results;
}

// "Remind now" from the UI — uses today's offset as the stage
export async function sendReminderNow(orgId: string, invoiceId: string, now = new Date()) {
  const inv = await prisma.extractedInvoice.findFirstOrThrow({ where: { id: invoiceId, orgId } });
  if (!inv.dueDate) throw Object.assign(new Error("Invoice has no due date"), { status: 400 });
  if (inv.paymentStatus === "PAID") throw Object.assign(new Error("Invoice is already paid"), { status: 400 });
  const days = daysFromDue(inv.dueDate, now);
  const exists = await prisma.reminder.findUnique({ where: { invoiceId_offsetDays: { invoiceId, offsetDays: days } } });
  if (exists) throw Object.assign(new Error("A reminder for this invoice already went out today"), { status: 409 });
  return deliver(inv, days, days);
}
