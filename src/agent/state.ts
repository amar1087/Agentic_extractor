// src/agent/state.ts
// PURPOSE: The state object that flows through every node of the graph.
// Each node receives the full state and returns only the fields it updates.
// Everything here is JSON-serialisable so the PostgresSaver can checkpoint it.

import { Annotation } from "@langchain/langgraph";
import { Invoice } from "../validation/schema.js";

export type SourceType = "EMAIL_PDF" | "EMAIL_IMAGE" | "EMAIL_TEXT" | "API";
export type ReviewReason = "UNKNOWN_VENDOR" | "VALIDATION_EXHAUSTED" | "POLICY";

export interface ReviewDecision {
  action: "APPROVE" | "REJECT" | "APPROVE_AND_WHITELIST";
  reason?: string;
  corrected?: Invoice; // reviewer-edited extraction, already Zod-validated by the API
  decidedBy: string;
}

export const AgentState = Annotation.Root({
  // Identity — jobId is also the LangGraph thread_id
  jobId: Annotation<string>(),
  orgId: Annotation<string>(),
  sourceType: Annotation<SourceType>(),

  // Input — a stored file (PDF / image) and/or plain text (email body, API payload).
  // PARSE fills `text`; images stay as files and go to the vision model.
  filePath: Annotation<string | null>(),
  mimeType: Annotation<string | null>(),
  text: Annotation<string>(),

  // AI extraction result
  extracted: Annotation<Invoice | null>(),

  // Processing state
  retryCount: Annotation<number>(), // extraction attempts made so far
  maxRetries: Annotation<number>(),
  errors: Annotation<string[]>(),
  status: Annotation<string>(),
  note: Annotation<string | null>(), // human-readable summary of the last node, shown in the UI

  // Human-in-the-loop
  reviewReason: Annotation<ReviewReason | null>(),
  decision: Annotation<ReviewDecision | null>(),

  // Result
  invoiceId: Annotation<string | null>(),
});

export type AgentStateType = typeof AgentState.State;
