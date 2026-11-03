import { BellRing, Calculator, Database, Inbox, LucideIcon, ShieldCheck, Sparkles, UserCheck, XCircle } from "lucide-react";

export interface AgentMeta {
  node: string;
  name: string;
  role: string;
  icon: LucideIcon;
  color: string; // hex, used for SVG + accents
}

// Each LangGraph node is presented as an agent with a single responsibility
export const AGENTS: Record<string, AgentMeta> = {
  PARSE: { node: "PARSE", name: "Intake", role: "Reads PDFs, images and email bodies", icon: Inbox, color: "#0ea5e9" },
  EXTRACT: { node: "EXTRACT", name: "Extractor", role: "LLM → structured invoice JSON", icon: Sparkles, color: "#8b5cf6" },
  VALIDATE: { node: "VALIDATE", name: "Auditor", role: "5 financial rules in Decimal math", icon: Calculator, color: "#f59e0b" },
  VERIFY: { node: "VERIFY", name: "Compliance", role: "Duplicates, policy, vendor whitelist", icon: ShieldCheck, color: "#10b981" },
  HUMAN_REVIEW: { node: "HUMAN_REVIEW", name: "Human reviewer", role: "Approves exceptions", icon: UserCheck, color: "#f43f5e" },
  STORE: { node: "STORE", name: "Ledger", role: "Persists to payables in integer cents", icon: Database, color: "#6366f1" },
  REJECTED: { node: "REJECTED", name: "Discard", role: "Rejected or duplicate", icon: XCircle, color: "#64748b" },
  REMINDER: { node: "REMINDER", name: "Collections", role: "Drafts & sends due-date reminders", icon: BellRing, color: "#f97316" },
};

export const PIPELINE = ["PARSE", "EXTRACT", "VALIDATE", "VERIFY", "STORE"] as const;

export const OUTCOME_TONE: Record<string, "ok" | "bad" | "warn" | "info" | "muted"> = {
  PASS: "ok",
  APPROVE: "ok",
  DECISION: "info",
  FAIL: "bad",
  REJECT: "bad",
  ESCALATE: "warn",
  WAITING: "warn",
  SKIP: "muted",
};

export const JOB_STATUS: Record<string, { label: string; tone: "ok" | "bad" | "warn" | "info" | "muted" | "accent" }> = {
  QUEUED: { label: "Queued", tone: "muted" },
  RUNNING: { label: "Running", tone: "accent" },
  AWAITING_REVIEW: { label: "Needs review", tone: "warn" },
  COMPLETE: { label: "Complete", tone: "ok" },
  REJECTED: { label: "Rejected", tone: "bad" },
  DUPLICATE: { label: "Duplicate", tone: "muted" },
  FAILED: { label: "Failed", tone: "bad" },
};

export const REVIEW_REASON: Record<string, { title: string; help: string }> = {
  UNKNOWN_VENDOR: {
    title: "Unknown vendor",
    help: "The invoice passed every financial check, but this vendor is not on your approved list.",
  },
  VALIDATION_EXHAUSTED: {
    title: "Validation failed after retries",
    help: "The extractor retried with targeted feedback but the numbers still do not reconcile. Correct the fields or reject.",
  },
  POLICY: {
    title: "Policy check failed",
    help: "A tenant policy (tax ID, due date or currency) was not satisfied.",
  },
};
