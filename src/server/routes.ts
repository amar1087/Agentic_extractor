// src/server/routes.ts
// PURPOSE: REST API for the dashboard, review workflow and programmatic ingestion.
// Every handler scopes queries by req.auth.orgId taken from the verified JWT.

import { Router } from "express";
import fs from "fs/promises";
import multer from "multer";
import path from "path";
import { z } from "zod";
import { ReviewDecision } from "../agent/state.js";
import { hashPassword, issueToken, requireAuth, requireRole, setSessionCookie, verifyPassword, COOKIE } from "../auth/session.js";
import { config } from "../config.js";
import { prisma } from "../db/client.js";
import { bus, BusMessage, recordEvent } from "../events/bus.js";
import { getConsentUrl, isGmailConfigured } from "../ingestion/gmail/oauth.js";
import { syncGmail } from "../ingestion/gmail/sync.js";
import { ingestDocument } from "../ingestion/ingest.js";
import { llmHealth } from "../llm/client.js";
import { enqueueJob, enqueueResume, queueDepth } from "../queue/queue.js";
import { daysFromDue, runReminderAgent, sendReminderNow } from "../reminders/agent.js";
import { activeChannel } from "../reminders/mailer.js";
import { InvoiceSchema } from "../validation/schema.js";

export const api = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const SAMPLES_DIR = path.resolve("samples");

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

// ── Auth ──────────────────────────────────────────────────────────────────────

api.post("/auth/login", async (req, res) => {
  const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const token = issueToken({ sub: user.id, orgId: user.orgId, role: user.role as any, email: user.email, name: user.name });
  setSessionCookie(res, token);
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

api.post("/auth/logout", (_req, res) => {
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

api.get("/health", async (_req, res) => {
  const [db, llm] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    llmHealth(),
  ]);
  res.json({
    db,
    llm: { ...llm, provider: config.llm.provider, model: config.llm.model, visionModel: config.llm.visionModel,
      modelAvailable: llm.models.some((m) => m === config.llm.model || m.startsWith(config.llm.model + ":")),
      visionAvailable: llm.models.some((m) => m === config.llm.visionModel) },
    queue: queueDepth(),
    gmailConfigured: isGmailConfigured(),
  });
});

api.use(requireAuth);

api.get("/auth/me", async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { id: req.auth!.orgId } });
  res.json({ user: req.auth, org });
});

// ── Live events (SSE) ─────────────────────────────────────────────────────────

api.get("/events/stream", (req, res) => {
  const orgId = req.auth!.orgId;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(": connected\n\n");
  const onMessage = (msg: BusMessage) => {
    if (msg.orgId !== orgId) return; // tenant isolation for the stream
    res.write(`data: ${JSON.stringify(msg)}\n\n`);
  };
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  bus.on("message", onMessage);
  req.on("close", () => {
    clearInterval(ping);
    bus.off("message", onMessage);
  });
});

api.get("/events/recent", async (req, res) => {
  const events = await prisma.agentEvent.findMany({
    where: { orgId: req.auth!.orgId, phase: "END" },
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(req.query.limit ?? 30), 100),
    include: { job: { select: { fileName: true, emailSubject: true } } },
  });
  res.json(events);
});

// ── Dashboard stats ───────────────────────────────────────────────────────────

api.get("/stats", async (req, res) => {
  const orgId = req.auth!.orgId;
  const now = new Date();
  const since14 = new Date(now.getTime() - 13 * 86_400_000);
  since14.setUTCHours(0, 0, 0, 0);

  const [jobCounts, unpaid, recentJobs, nodeTimings, hitlCount, remindersSent, paidThisMonth] = await Promise.all([
    prisma.ingestionJob.groupBy({ by: ["status"], where: { orgId }, _count: true }),
    prisma.extractedInvoice.findMany({
      where: { orgId, status: "COMPLETE", paymentStatus: "UNPAID" },
      select: { grandTotalCents: true, currency: true, dueDate: true },
    }),
    prisma.ingestionJob.findMany({ where: { orgId, createdAt: { gte: since14 } }, select: { createdAt: true, status: true, retryCount: true } }),
    prisma.agentEvent.groupBy({ by: ["node"], where: { orgId, phase: "END", durationMs: { not: null } }, _avg: { durationMs: true }, _count: true }),
    prisma.checkpoint.count({ where: { orgId } }),
    prisma.reminder.count({ where: { orgId, createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } } }),
    prisma.extractedInvoice.aggregate({
      where: { orgId, paymentStatus: "PAID", paidAt: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) } },
      _sum: { grandTotalCents: true }, _count: true,
    }),
  ]);

  const byStatus = Object.fromEntries(jobCounts.map((c) => [c.status, c._count]));
  const totalJobs = jobCounts.reduce((s, c) => s + c._count, 0);
  const finished = (byStatus.COMPLETE ?? 0) + (byStatus.REJECTED ?? 0) + (byStatus.FAILED ?? 0) + (byStatus.DUPLICATE ?? 0);

  // Most common currency is the headline currency; others are reported separately
  const currencyCounts = new Map<string, number>();
  unpaid.forEach((i) => currencyCounts.set(i.currency ?? "USD", (currencyCounts.get(i.currency ?? "USD") ?? 0) + 1));
  const primaryCurrency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";

  const aging = [
    { bucket: "Not due", cents: 0, count: 0 },
    { bucket: "1–30", cents: 0, count: 0 },
    { bucket: "31–60", cents: 0, count: 0 },
    { bucket: "61–90", cents: 0, count: 0 },
    { bucket: "90+", cents: 0, count: 0 },
  ];
  let outstanding = 0, overdueCents = 0, overdueCount = 0, dueSoonCents = 0, dueSoonCount = 0;
  for (const inv of unpaid) {
    if ((inv.currency ?? "USD") !== primaryCurrency) continue;
    outstanding += inv.grandTotalCents;
    const d = inv.dueDate ? daysFromDue(inv.dueDate, now) : -1;
    const idx = d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4;
    aging[idx].cents += inv.grandTotalCents;
    aging[idx].count++;
    if (d > 0) { overdueCents += inv.grandTotalCents; overdueCount++; }
    if (d <= 0 && d >= -7) { dueSoonCents += inv.grandTotalCents; dueSoonCount++; }
  }

  const throughput = Array.from({ length: 14 }, (_, i) => {
    const day = new Date(since14.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    return { day, complete: 0, review: 0, failed: 0 };
  });
  for (const j of recentJobs) {
    const slot = throughput.find((t) => t.day === j.createdAt.toISOString().slice(0, 10));
    if (!slot) continue;
    if (j.status === "COMPLETE" || j.status === "DUPLICATE") slot.complete++;
    else if (j.status === "AWAITING_REVIEW") slot.review++;
    else if (j.status === "FAILED" || j.status === "REJECTED") slot.failed++;
  }

  const retried = recentJobs.filter((j) => j.retryCount > 1).length;

  res.json({
    jobs: { total: totalJobs, byStatus },
    payables: {
      currency: primaryCurrency,
      outstandingCents: outstanding,
      openCount: unpaid.filter((i) => (i.currency ?? "USD") === primaryCurrency).length,
      otherCurrencies: [...currencyCounts.keys()].filter((c) => c !== primaryCurrency),
      overdueCents, overdueCount, dueSoonCents, dueSoonCount,
      paidThisMonthCents: paidThisMonth._sum.grandTotalCents ?? 0,
      paidThisMonthCount: paidThisMonth._count,
    },
    aging,
    throughput,
    metrics: {
      successRate: finished ? (byStatus.COMPLETE ?? 0) / finished : null,
      retryRate: recentJobs.length ? retried / recentJobs.length : null,
      hitlRate: totalJobs ? hitlCount / totalJobs : null,
      remindersSent30d: remindersSent,
    },
    nodeTimings: nodeTimings.map((n) => ({ node: n.node, avgMs: Math.round(n._avg.durationMs ?? 0), runs: n._count })),
    queue: queueDepth(),
  });
});

// ── Ingestion ─────────────────────────────────────────────────────────────────

api.post("/ingest", requireRole("admin", "reviewer"), upload.single("file"), async (req, res) => {
  const orgId = req.auth!.orgId;
  const viaApi = !!req.headers.authorization;
  if (req.file) {
    const mime = req.file.mimetype === "image/jpg" ? "image/jpeg" : req.file.mimetype;
    const result = await ingestDocument({ orgId, source: viaApi ? "API" : "UPLOAD", content: req.file.buffer, mimeType: mime, fileName: req.file.originalname });
    return res.status(result.duplicate ? 200 : 201).json(result);
  }
  const { text, fileName } = z.object({ text: z.string().min(10), fileName: z.string().optional() }).parse(req.body);
  const result = await ingestDocument({ orgId, source: viaApi ? "API" : "UPLOAD", content: text, mimeType: "text/plain", fileName: fileName ?? "pasted-invoice.txt" });
  res.status(result.duplicate ? 200 : 201).json(result);
});

// Sample invoices let a fresh install demo every path through the graph.
// {{DATE:+5}} placeholders are relative to today so due-date reminders stay realistic.
function renderSample(text: string, now = new Date()) {
  return text.replace(/\{\{DATE:([+-]\d+)\}\}/g, (_m, offset) => new Date(now.getTime() + Number(offset) * 86_400_000).toISOString().slice(0, 10));
}

api.get("/samples", async (_req, res) => {
  const files = (await fs.readdir(SAMPLES_DIR).catch(() => [])).filter((f) => f.endsWith(".txt"));
  const samples = await Promise.all(files.map(async (f) => {
    const raw = await fs.readFile(path.join(SAMPLES_DIR, f), "utf-8");
    const [first, ...rest] = raw.split("\n");
    return { id: f, title: first.replace(/^#\s*/, ""), scenario: rest[0]?.replace(/^#\s*/, "") ?? "", preview: renderSample(rest.slice(1).join("\n")).trim() };
  }));
  res.json(samples);
});

api.post("/samples/:id/ingest", requireRole("admin", "reviewer"), async (req, res) => {
  const id = path.basename(String(req.params.id));
  const raw = await fs.readFile(path.join(SAMPLES_DIR, id), "utf-8").catch(() => { throw httpError(404, "Sample not found"); });
  const body = renderSample(raw.split("\n").slice(2).join("\n")).trim();
  const result = await ingestDocument({ orgId: req.auth!.orgId, source: "UPLOAD", content: body, mimeType: "text/plain", fileName: id });
  res.status(result.duplicate ? 200 : 201).json(result);
});

// ── Jobs (agent runs) ─────────────────────────────────────────────────────────

api.get("/jobs", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const jobs = await prisma.ingestionJob.findMany({
    where: { orgId: req.auth!.orgId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(req.query.limit ?? 100), 500),
    select: {
      id: true, source: true, sourceType: true, fileName: true, emailFrom: true, emailSubject: true,
      status: true, currentNode: true, retryCount: true, createdAt: true, updatedAt: true, invoiceId: true,
      extractedJson: true,
    },
  });
  res.json(jobs);
});

api.get("/jobs/:id", async (req, res) => {
  const job = await prisma.ingestionJob.findFirst({
    where: { id: String(req.params.id), orgId: req.auth!.orgId },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      invoice: true,
    },
  });
  if (!job) throw httpError(404, "Job not found");
  const checkpoint = await prisma.checkpoint.findUnique({ where: { jobId: job.id } });
  const preview = job.mimeType === "text/plain" && job.filePath ? await fs.readFile(job.filePath, "utf-8").catch(() => null) : null;
  res.json({ ...job, filePath: undefined, checkpoint, textPreview: preview });
});

api.get("/jobs/:id/file", async (req, res) => {
  const job = await prisma.ingestionJob.findFirst({ where: { id: String(req.params.id), orgId: req.auth!.orgId } });
  if (!job?.filePath) throw httpError(404, "No stored file");
  res.type(job.mimeType ?? "application/octet-stream").sendFile(job.filePath);
});

api.post("/jobs/:id/retry", requireRole("admin", "reviewer"), async (req, res) => {
  const job = await prisma.ingestionJob.findFirst({ where: { id: String(req.params.id), orgId: req.auth!.orgId } });
  if (!job) throw httpError(404, "Job not found");
  if (job.status !== "FAILED") throw httpError(400, "Only failed jobs can be retried");
  // Fresh thread: drop the old checkpoint history so the graph starts from PARSE
  await prisma.$executeRawUnsafe(`DELETE FROM langgraph.checkpoints WHERE thread_id = $1`, job.id).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM langgraph.checkpoint_writes WHERE thread_id = $1`, job.id).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM langgraph.checkpoint_blobs WHERE thread_id = $1`, job.id).catch(() => {});
  await prisma.ingestionJob.update({ where: { id: job.id }, data: { status: "QUEUED", errors: [], retryCount: 0 } });
  enqueueJob(job.id);
  res.json({ ok: true });
});

// ── Human review (FR-07) ──────────────────────────────────────────────────────

api.get("/review", async (req, res) => {
  const items = await prisma.checkpoint.findMany({
    where: { orgId: req.auth!.orgId, resolvedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const jobs = await prisma.ingestionJob.findMany({
    where: { id: { in: items.map((i) => i.jobId) } },
    select: { id: true, fileName: true, emailFrom: true, emailSubject: true, sourceType: true, createdAt: true, status: true },
  });
  res.json(items.map((i) => ({ ...i, job: jobs.find((j) => j.id === i.jobId) })));
});

api.get("/review/:jobId", async (req, res) => {
  const checkpoint = await prisma.checkpoint.findFirst({ where: { jobId: String(req.params.jobId), orgId: req.auth!.orgId } });
  if (!checkpoint) throw httpError(404, "No review for this job");
  res.json(checkpoint);
});

const DecisionBody = z.object({
  action: z.enum(["APPROVE", "REJECT", "APPROVE_AND_WHITELIST"]),
  reason: z.string().max(500).optional(),
  corrected: z.unknown().optional(),
});

api.post("/review/:jobId/decision", requireRole("admin", "reviewer"), async (req, res) => {
  const orgId = req.auth!.orgId;
  const body = DecisionBody.parse(req.body);
  const checkpoint = await prisma.checkpoint.findFirst({ where: { jobId: String(req.params.jobId), orgId } });
  if (!checkpoint) throw httpError(404, "No review for this job");
  if (checkpoint.resolvedAt) throw httpError(409, "This review was already decided");
  if (checkpoint.expiresAt < new Date()) throw httpError(410, "The review window has expired");

  let corrected;
  if (body.corrected !== undefined) {
    const parsed = InvoiceSchema.safeParse(body.corrected);
    if (!parsed.success) {
      return res.status(400).json({ error: "Corrected invoice is invalid", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    }
    corrected = parsed.data;
  }
  const snapshotExtracted = (checkpoint.snapshot as any)?.extracted;
  if (body.action !== "REJECT" && !corrected && !snapshotExtracted) {
    throw httpError(400, "Nothing was extracted — enter the invoice fields to approve it");
  }

  const decision: ReviewDecision = { action: body.action, reason: body.reason, corrected, decidedBy: req.auth!.email };
  await recordEvent({
    jobId: checkpoint.jobId, orgId, node: "HUMAN_REVIEW", phase: "END", outcome: "DECISION",
    message: `${req.auth!.name} chose ${body.action.replace(/_/g, " ").toLowerCase()}${corrected ? " with corrections" : ""}`,
  });
  enqueueResume(checkpoint.jobId, decision);
  res.json({ ok: true });
});

// ── Invoices (ledger) ─────────────────────────────────────────────────────────

function withDue<T extends { dueDate: Date | null; paymentStatus: string }>(inv: T) {
  const days = inv.dueDate ? daysFromDue(inv.dueDate) : null;
  return { ...inv, daysFromDue: days, isOverdue: inv.paymentStatus === "UNPAID" && days !== null && days > 0 };
}

api.get("/invoices", async (req, res) => {
  const { payment, q } = req.query as Record<string, string | undefined>;
  const invoices = await prisma.extractedInvoice.findMany({
    where: {
      orgId: req.auth!.orgId,
      ...(payment === "PAID" || payment === "UNPAID" ? { paymentStatus: payment } : {}),
      ...(q ? { OR: [{ vendorName: { contains: q, mode: "insensitive" } }, { invoiceRef: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ dueDate: "asc" }],
    include: { _count: { select: { reminders: true } }, job: { select: { id: true, source: true } } },
  });
  res.json(invoices.map(withDue));
});

api.get("/invoices/:id", async (req, res) => {
  const inv = await prisma.extractedInvoice.findFirst({
    where: { id: String(req.params.id), orgId: req.auth!.orgId },
    include: { reminders: { orderBy: { createdAt: "desc" } }, job: { select: { id: true, source: true, fileName: true, emailFrom: true, emailSubject: true, mimeType: true } } },
  });
  if (!inv) throw httpError(404, "Invoice not found");
  res.json(withDue(inv));
});

api.post("/invoices/:id/payment", requireRole("admin", "reviewer"), async (req, res) => {
  const { status } = z.object({ status: z.enum(["PAID", "UNPAID"]) }).parse(req.body);
  const inv = await prisma.extractedInvoice.findFirst({ where: { id: String(req.params.id), orgId: req.auth!.orgId } });
  if (!inv) throw httpError(404, "Invoice not found");
  const updated = await prisma.extractedInvoice.update({
    where: { id: inv.id },
    data: { paymentStatus: status, paidAt: status === "PAID" ? new Date() : null },
  });
  res.json(withDue(updated));
});

api.post("/invoices/:id/remind", requireRole("admin", "reviewer"), async (req, res) => {
  res.json(await sendReminderNow(req.auth!.orgId, String(req.params.id)));
});

// ── Reminders ─────────────────────────────────────────────────────────────────

api.get("/reminders", async (req, res) => {
  const orgId = req.auth!.orgId;
  const [reminders, cfg, channel, upcoming] = await Promise.all([
    prisma.reminder.findMany({
      where: { orgId }, orderBy: { createdAt: "desc" }, take: 200,
      include: { invoice: { select: { vendorName: true, invoiceRef: true, grandTotalCents: true, currency: true, dueDate: true, paymentStatus: true } } },
    }),
    prisma.tenantConfig.findUnique({ where: { orgId } }),
    activeChannel(orgId),
    prisma.extractedInvoice.findMany({
      where: { orgId, status: "COMPLETE", paymentStatus: "UNPAID", dueDate: { not: null } },
      include: { reminders: { select: { offsetDays: true } } },
      orderBy: { dueDate: "asc" },
    }),
  ]);

  // Next stage each unpaid invoice will hit
  const offsets = [...(cfg?.reminderOffsetsDays?.length ? cfg.reminderOffsetsDays : [-3, 0, 7])].sort((a, b) => a - b);
  const schedule = upcoming.flatMap((inv) => {
    const days = daysFromDue(inv.dueDate!);
    const sent = inv.reminders.map((r) => r.offsetDays);
    const next = offsets.find((o) => o >= days && !sent.some((s) => s >= o));
    const dueNow = offsets.filter((o) => o <= days).pop();
    const pendingNow = dueNow !== undefined && !sent.some((s) => s >= dueNow);
    const stage = pendingNow ? dueNow : next;
    if (stage === undefined) return [];
    const at = new Date(inv.dueDate!.getTime() + stage * 86_400_000);
    return [{ invoiceId: inv.id, vendorName: inv.vendorName, invoiceRef: inv.invoiceRef, grandTotalCents: inv.grandTotalCents, currency: inv.currency, dueDate: inv.dueDate, offsetDays: stage, scheduledFor: pendingNow ? new Date() : at, readyNow: pendingNow }];
  });

  res.json({ reminders, schedule, channel, enabled: cfg?.remindersEnabled ?? true, offsets });
});

api.post("/reminders/run", requireRole("admin", "reviewer"), async (req, res) => {
  res.json({ sent: await runReminderAgent(req.auth!.orgId) });
});

// ── Vendors (whitelist) ───────────────────────────────────────────────────────

api.get("/vendors", async (req, res) => {
  const orgId = req.auth!.orgId;
  const [vendors, totals] = await Promise.all([
    prisma.vendorWhitelist.findMany({ where: { orgId }, orderBy: { vendorName: "asc" } }),
    prisma.extractedInvoice.groupBy({ by: ["vendorName"], where: { orgId }, _count: true, _sum: { grandTotalCents: true } }),
  ]);
  res.json(vendors.map((v) => {
    const t = totals.find((x) => x.vendorName.toLowerCase() === v.vendorName.toLowerCase());
    return { ...v, invoiceCount: t?._count ?? 0, totalCents: t?._sum.grandTotalCents ?? 0 };
  }));
});

api.post("/vendors", requireRole("admin"), async (req, res) => {
  const { vendorName, taxId } = z.object({ vendorName: z.string().trim().min(1), taxId: z.string().trim().optional() }).parse(req.body);
  const vendor = await prisma.vendorWhitelist.upsert({
    where: { orgId_vendorName: { orgId: req.auth!.orgId, vendorName } },
    update: { taxId: taxId || null },
    create: { orgId: req.auth!.orgId, vendorName, taxId: taxId || null, approvedBy: req.auth!.email },
  });
  res.status(201).json(vendor);
});

api.delete("/vendors/:id", requireRole("admin"), async (req, res) => {
  const { count } = await prisma.vendorWhitelist.deleteMany({ where: { id: String(req.params.id), orgId: req.auth!.orgId } });
  if (!count) throw httpError(404, "Vendor not found");
  res.json({ ok: true });
});

// ── Tenant config ─────────────────────────────────────────────────────────────

const ConfigBody = z.object({
  autoVerifyVendors: z.boolean(),
  requireVendorTaxId: z.boolean(),
  requireDueDate: z.boolean(),
  reviewTimeoutHours: z.number().int().min(1).max(720),
  reviewerEmails: z.array(z.string().email()),
  reviewWebhookUrl: z.string().url().nullable().or(z.literal("").transform(() => null)),
  maxRetries: z.number().int().min(0).max(5),
  defaultCurrency: z.string().length(3).nullable(),
  supportedCurrencies: z.array(z.string().length(3)),
  remindersEnabled: z.boolean(),
  reminderRecipients: z.array(z.string().email()),
  reminderOffsetsDays: z.array(z.number().int().min(-60).max(180)).min(1),
}).partial();

api.get("/config", async (req, res) => {
  const orgId = req.auth!.orgId;
  const cfg = await prisma.tenantConfig.upsert({ where: { orgId }, update: {}, create: { orgId, reviewerEmails: [], supportedCurrencies: [], reminderRecipients: [] } });
  res.json(cfg);
});

api.put("/config", requireRole("admin"), async (req, res) => {
  const orgId = req.auth!.orgId;
  const data = ConfigBody.parse(req.body);
  const cfg = await prisma.tenantConfig.upsert({
    where: { orgId },
    update: data,
    create: { orgId, reviewerEmails: [], supportedCurrencies: [], reminderRecipients: [], ...data },
  });
  res.json(cfg);
});

// ── Mailbox (Gmail) ───────────────────────────────────────────────────────────

api.get("/mailbox", async (req, res) => {
  const conn = await prisma.mailboxConnection.findUnique({ where: { orgId: req.auth!.orgId } });
  res.json({
    configured: isGmailConfigured(),
    connection: conn && { provider: conn.provider, emailAddress: conn.emailAddress, status: conn.status, lastSyncedAt: conn.lastSyncedAt, canSend: conn.canSend },
    pollMinutes: config.gmail.pollMinutes,
  });
});

api.post("/mailbox/connect", requireRole("admin"), (req, res) => {
  if (!isGmailConfigured()) throw httpError(400, "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set on the server");
  res.json({ url: getConsentUrl(req.auth!.orgId) });
});

api.post("/mailbox/sync", requireRole("admin", "reviewer"), async (req, res) => {
  res.json(await syncGmail(req.auth!.orgId));
});

api.delete("/mailbox", requireRole("admin"), async (req, res) => {
  await prisma.mailboxConnection.deleteMany({ where: { orgId: req.auth!.orgId } });
  res.json({ ok: true });
});

// ── Users (admin can add reviewers) ───────────────────────────────────────────

api.get("/users", requireRole("admin"), async (req, res) => {
  res.json(await prisma.user.findMany({ where: { orgId: req.auth!.orgId }, select: { id: true, email: true, name: true, role: true, createdAt: true } }));
});

api.post("/users", requireRole("admin"), async (req, res) => {
  const body = z.object({ email: z.string().email(), name: z.string().min(1), role: z.enum(["admin", "reviewer", "viewer"]), password: z.string().min(10) }).parse(req.body);
  const user = await prisma.user.create({
    data: { orgId: req.auth!.orgId, email: body.email.toLowerCase(), name: body.name, role: body.role, passwordHash: hashPassword(body.password) },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
  res.status(201).json(user);
});
