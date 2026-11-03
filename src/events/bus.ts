// src/events/bus.ts
// PURPOSE: Records agent node transitions (structured JSON log + AgentEvent row)
// and fans them out to connected UI clients over Server-Sent Events.

import { EventEmitter } from "events";
import { prisma } from "../db/client.js";

export type BusMessage =
  | { type: "agent-event"; orgId: string; jobId: string; event: unknown }
  | { type: "job-updated"; orgId: string; jobId: string; status: string; currentNode?: string | null }
  | { type: "reminder-sent"; orgId: string; reminderId: string; invoiceId: string }
  | { type: "mailbox-synced"; orgId: string; imported: number };

export const bus = new EventEmitter();
bus.setMaxListeners(200);

export function publish(msg: BusMessage) {
  bus.emit("message", msg);
}

export async function recordEvent(e: {
  jobId: string;
  orgId: string;
  node: string;
  phase: "START" | "END";
  outcome?: string;
  message?: string;
  durationMs?: number;
  data?: unknown;
}) {
  // SRS 7.1 — one structured log line per node transition
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: e.outcome === "FAIL" ? "WARN" : "INFO",
    service: "agentic-extractor-worker",
    orgId: e.orgId, jobId: e.jobId, node: e.node, phase: e.phase,
    outcome: e.outcome, durationMs: e.durationMs, message: e.message,
  }));

  const row = await prisma.agentEvent.create({
    data: {
      jobId: e.jobId,
      orgId: e.orgId,
      node: e.node,
      phase: e.phase,
      outcome: e.outcome,
      message: e.message,
      durationMs: e.durationMs,
      data: e.data as any,
    },
  });
  publish({ type: "agent-event", orgId: e.orgId, jobId: e.jobId, event: row });
  return row;
}

export async function updateJob(jobId: string, data: Record<string, unknown>) {
  const job = await prisma.ingestionJob.update({ where: { id: jobId }, data: data as any });
  publish({ type: "job-updated", orgId: job.orgId, jobId, status: job.status, currentNode: job.currentNode });
  return job;
}
