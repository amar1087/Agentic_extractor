// src/agent/nodes/validate.ts
// PURPOSE: Runs the financial validation engine (Decimal math) on the extraction.
// Failures route back to EXTRACT with the errors as context.

import { validateInvoice } from "../../validation/engine.js";
import { AgentStateType } from "../state.js";

export async function validateNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  if (!state.extracted) {
    return {
      errors: state.errors.length > 0 ? state.errors : ["No extracted data to validate"],
      status: "VALIDATION_SKIPPED",
      note: "Nothing to validate — extraction failed",
    };
  }

  const errors = validateInvoice(state.extracted).map((e) => `Rule ${e.rule} (${e.field}): ${e.message}`);

  if (errors.length === 0) {
    return { errors: [], status: "VALIDATED", note: "All 5 rules passed — totals reconcile to the cent" };
  }

  return {
    errors,
    status: "VALIDATION_FAILED",
    note: errors.length === 1 ? errors[0] : `${errors.length} rule violations — ${errors[0]}`,
  };
}
