// src/agent/graph.ts
// PURPOSE: The main LangGraph state machine.
// Wires the agent nodes together with conditional routing logic.
//
// Flow:
//   START → PARSE → EXTRACT → VALIDATE → VERIFY → STORE → END
//                      ↑          |          |
//                      └──────────┘          ├─ duplicate → REJECTED → END
//                (retry up to maxRetries)    ↓
//                                 exhausted retries / unknown vendor / policy
//                                            ↓
//                                      HUMAN_REVIEW  (interrupt — waits for a reviewer)
//                                  approve → STORE · whitelist → VERIFY · reject → REJECTED
//
// The graph is compiled with a PostgresSaver checkpointer and thread_id = jobId,
// so a run paused at HUMAN_REVIEW survives restarts and resumes exactly there.

import { Command, isGraphInterrupt, StateGraph } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { prisma } from "../db/client.js";
import { recordEvent, updateJob } from "../events/bus.js";
import { extractNode } from "./nodes/extract.js";
import { hitlNode } from "./nodes/hitl.js";
import { parseNode } from "./nodes/parse.js";
import { rejectedNode } from "./nodes/rejected.js";
import { storeNode } from "./nodes/store.js";
import { validateNode } from "./nodes/validate.js";
import { verifyNode } from "./nodes/verify.js";
import { AgentState, AgentStateType, ReviewDecision, SourceType } from "./state.js";

export type { AgentStateType } from "./state.js";

// ── Telemetry ─────────────────────────────────────────────────────────────────
// Wraps every node so each transition becomes an AgentEvent (UI timeline) and a
// structured log line (SRS 7.1). Outcome is derived from the status a node sets.

const OUTCOMES: Record<string, string> = {
  PARSED: "PASS", PARSE_FAILED: "FAIL",
  EXTRACTED: "PASS", EXTRACT_SCHEMA_FAIL: "FAIL", EXTRACT_FAILED: "FAIL",
  VALIDATED: "PASS", VALIDATION_FAILED: "FAIL", VALIDATION_SKIPPED: "FAIL",
  VENDOR_KNOWN: "PASS", VENDOR_UNKNOWN: "ESCALATE", POLICY_FAILED: "ESCALATE", DUPLICATE: "SKIP",
  VERIFY_FAILED: "FAIL", VERIFY_SKIPPED: "FAIL",
  APPROVED: "APPROVE", WHITELISTED: "APPROVE", REJECTED: "REJECT",
  COMPLETED: "PASS", STORE_FAILED: "FAIL",
};

function instrument<T extends (state: AgentStateType) => Promise<any>>(node: string, fn: T) {
  return async (state: AgentStateType) => {
    const start = Date.now();
    await updateJob(state.jobId, { status: "RUNNING", currentNode: node, retryCount: state.retryCount });
    await recordEvent({ jobId: state.jobId, orgId: state.orgId, node, phase: "START" });
    try {
      const out = await fn(state);
      const update: Partial<AgentStateType> = out instanceof Command ? (out.update as any) : out;
      await recordEvent({
        jobId: state.jobId, orgId: state.orgId, node, phase: "END",
        outcome: OUTCOMES[update.status ?? ""] ?? update.status,
        message: update.note ?? undefined,
        durationMs: Date.now() - start,
        data: update.errors?.length ? { errors: update.errors } : undefined,
      });
      return out;
    } catch (err) {
      if (isGraphInterrupt(err)) {
        await recordEvent({
          jobId: state.jobId, orgId: state.orgId, node, phase: "END",
          outcome: "WAITING", message: "Paused — waiting for a human decision",
          durationMs: Date.now() - start,
        });
      }
      throw err;
    }
  };
}

// ── Routing logic ─────────────────────────────────────────────────────────────

function routeAfterParse(state: AgentStateType): string {
  if (state.status === "PARSE_FAILED") return "HUMAN_REVIEW";
  return "EXTRACT";
}

function routeAfterValidate(state: AgentStateType): string {
  // No errors → proceed to vendor verification
  if (state.errors.length === 0) return "VERIFY";

  // retryCount counts attempts, so maxRetries=2 allows 3 attempts in total (FR-03)
  if (state.retryCount <= state.maxRetries) return "EXTRACT";

  // Exhausted all retries → escalate to human review
  return "HUMAN_REVIEW";
}

function routeAfterVerify(state: AgentStateType): string {
  if (state.status === "DUPLICATE") return "REJECTED";
  if (state.status === "VENDOR_KNOWN") return "STORE";
  return "HUMAN_REVIEW";
}

// ── Build Graph ───────────────────────────────────────────────────────────────

const graph = new StateGraph(AgentState)
  .addNode("PARSE", instrument("PARSE", parseNode))
  .addNode("EXTRACT", instrument("EXTRACT", extractNode))
  .addNode("VALIDATE", instrument("VALIDATE", validateNode))
  .addNode("VERIFY", instrument("VERIFY", verifyNode))
  .addNode("HUMAN_REVIEW", instrument("HUMAN_REVIEW", hitlNode), { ends: ["STORE", "VERIFY", "REJECTED"] })
  .addNode("STORE", instrument("STORE", storeNode))
  .addNode("REJECTED", instrument("REJECTED", rejectedNode))

  .addEdge("__start__", "PARSE")
  .addConditionalEdges("PARSE", routeAfterParse, { EXTRACT: "EXTRACT", HUMAN_REVIEW: "HUMAN_REVIEW" })
  .addEdge("EXTRACT", "VALIDATE")
  .addConditionalEdges("VALIDATE", routeAfterValidate, {
    VERIFY: "VERIFY",
    EXTRACT: "EXTRACT",
    HUMAN_REVIEW: "HUMAN_REVIEW",
  })
  .addConditionalEdges("VERIFY", routeAfterVerify, {
    STORE: "STORE",
    HUMAN_REVIEW: "HUMAN_REVIEW",
    REJECTED: "REJECTED",
  })
  .addEdge("STORE", "__end__")
  .addEdge("REJECTED", "__end__");

let compiled: ReturnType<typeof graph.compile> | null = null;

export async function getGraph() {
  if (compiled) return compiled;
  const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL!, { schema: "langgraph" });
  await checkpointer.setup();
  compiled = graph.compile({ checkpointer });
  return compiled;
}

// ── Run helpers ───────────────────────────────────────────────────────────────

const threadConfig = (jobId: string) => ({ configurable: { thread_id: jobId }, recursionLimit: 40 });

const FINAL_JOB_STATUS: Record<string, string> = {
  COMPLETED: "COMPLETE",
  REJECTED: "REJECTED",
  DUPLICATE: "DUPLICATE",
};

// After invoke() returns, the run either finished or is parked at an interrupt.
async function settle(jobId: string) {
  const g = await getGraph();
  const snapshot = await g.getState(threadConfig(jobId));
  const state = snapshot.values as AgentStateType;
  if (snapshot.next.length > 0) {
    return { paused: true, state };
  }
  await updateJob(jobId, {
    status: FINAL_JOB_STATUS[state.status] ?? "FAILED",
    currentNode: null,
    retryCount: state.retryCount,
    extractedJson: (state.extracted ?? undefined) as any,
    errors: state.errors,
  });
  return { paused: false, state };
}

export async function runJob(jobId: string) {
  const job = await prisma.ingestionJob.findUniqueOrThrow({ where: { id: jobId } });
  const g = await getGraph();
  const existing = await g.getState(threadConfig(jobId));

  if (existing.next.length > 0 && !existing.tasks.some((t) => t.interrupts.length > 0)) {
    // Crashed mid-run — continue from the last checkpoint
    await g.invoke(null, threadConfig(jobId));
  } else if (existing.next.length === 0) {
    const config = await prisma.tenantConfig.findUnique({ where: { orgId: job.orgId } });
    const initialState: AgentStateType = {
      jobId: job.id,
      orgId: job.orgId,
      sourceType: job.sourceType as SourceType,
      filePath: job.filePath,
      mimeType: job.mimeType,
      text: job.sourceType === "EMAIL_TEXT" || job.sourceType === "API"
        ? await readInlineText(job.filePath)
        : "",
      extracted: null,
      retryCount: 0,
      maxRetries: config?.maxRetries ?? 2,
      errors: [],
      status: "STARTED",
      note: null,
      reviewReason: null,
      decision: null,
      invoiceId: null,
    };
    await g.invoke(initialState, threadConfig(jobId));
  }
  return settle(jobId);
}

export async function resumeJob(jobId: string, decision: ReviewDecision) {
  const g = await getGraph();
  await g.invoke(new Command({ resume: decision }), threadConfig(jobId));
  return settle(jobId);
}

async function readInlineText(filePath: string | null) {
  if (!filePath) return "";
  const fs = await import("fs/promises");
  return fs.readFile(filePath, "utf-8");
}

// Kept for the CLI smoke test (src/test-graph.ts)
export { runJob as processJob };
