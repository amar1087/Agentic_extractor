// src/agent/nodes/rejected.ts
// PURPOSE: Terminal node for invoices that will not enter the ledger —
// rejected by a reviewer, or a duplicate of one already stored.

import { AgentStateType } from "../state.js";

export async function rejectedNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const isDuplicate = state.status === "DUPLICATE";
  return {
    status: isDuplicate ? "DUPLICATE" : "REJECTED",
    note: state.note ?? (isDuplicate ? "Duplicate — skipped" : "Rejected"),
  };
}
