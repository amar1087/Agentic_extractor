// src/queue/queue.ts
// PURPOSE: Decouples ingestion from processing.
// Locally this is an in-process queue with bounded concurrency (the local
// model is the bottleneck). In AWS the same enqueue calls map onto SQS FIFO
// with MessageGroupId = orgId and an ECS worker pool calling runJob/resumeJob.

import { config } from "../config.js";
import { prisma } from "../db/client.js";
import { resumeJob, runJob } from "../agent/graph.js";
import { updateJob } from "../events/bus.js";
import { ReviewDecision } from "../agent/state.js";

type Task = { label: string; jobId: string; run: () => Promise<unknown> };

const pending: Task[] = [];
const inFlight = new Set<string>();
let active = 0;

function pump() {
  while (active < config.llm.concurrency && pending.length > 0) {
    const task = pending.shift()!;
    active++;
    inFlight.add(task.jobId);
    task.run()
      .catch(async (err) => {
        console.error(JSON.stringify({ level: "ERROR", event: "JOB_CRASHED", task: task.label, jobId: task.jobId, error: err.message }));
        await updateJob(task.jobId, { status: "FAILED", currentNode: null, errors: [String(err.message)] }).catch(() => {});
      })
      .finally(() => {
        active--;
        inFlight.delete(task.jobId);
        pump();
      });
  }
}

export function enqueueJob(jobId: string) {
  if (inFlight.has(jobId) || pending.some((t) => t.jobId === jobId)) return;
  pending.push({ label: "run", jobId, run: () => runJob(jobId) });
  pump();
}

export function enqueueResume(jobId: string, decision: ReviewDecision) {
  pending.push({ label: "resume", jobId, run: () => resumeJob(jobId, decision) });
  pump();
}

export function queueDepth() {
  return { pending: pending.length, active };
}

// On boot, pick up anything that was queued or mid-run when the process stopped
export async function recoverJobs() {
  const jobs = await prisma.ingestionJob.findMany({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  jobs.forEach((j) => enqueueJob(j.id));
  return jobs.length;
}
