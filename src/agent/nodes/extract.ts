// src/agent/nodes/extract.ts
// PURPOSE: Calls the local model to extract structured JSON from the invoice.
// On retry, the prompt is mutated (SRS 4.3) — re-asking with an identical
// prompt would just produce the same wrong answer:
//   attempt 1: full extraction
//   attempt 2: feed back the specific validation errors
//   attempt 3+: simplified, tightly constrained instruction

import fs from "fs/promises";
import { chatJSON } from "../../llm/client.js";
import { InvoiceSchema, InvoiceJSONSchema } from "../../validation/schema.js";
import { AgentStateType } from "../state.js";

const SYSTEM = `You are an invoice data extraction specialist working for an accounts-payable team.
Return ONLY a JSON object matching the provided schema. Never invent values that are not on the invoice;
use null for optional fields that are absent. Copy numbers exactly as printed — do not "fix" the vendor's arithmetic.`;

const RULES = `Rules:
- All monetary values are plain numbers (no currency symbols, no thousands separators)
- quantity must be a positive number; if no quantity is printed use 1
- dates must be YYYY-MM-DD
- currency is a 3-letter ISO 4217 code (infer from symbols: $ → USD, € → EUR, £ → GBP, ₹ → INR)
- items must contain every line item on the invoice`;

function buildInitialPrompt(text: string): string {
  return `Extract all invoice data from the document below.

${RULES}

INVOICE:
${text}`;
}

function buildRetryPrompt(text: string, errors: string[], attempt: number): string {
  return `This is extraction attempt ${attempt}. Your previous extraction had these problems:
${errors.map((e, i) => `${i + 1}. ${e}`).join("\n")}

Re-read the invoice carefully and correct these specific fields. If the invoice itself is
inconsistent, report the values exactly as printed.

${RULES}

INVOICE:
${text}`;
}

function buildSimplifiedPrompt(text: string): string {
  return `Extract ONLY: vendor name, invoice number, issue date, due date, currency,
each line item (description, quantity, unit price, line total), subtotal, tax, grand total.
Read each number directly from the document. Return only the JSON.

INVOICE:
${text}`;
}

export async function extractNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const attempt = state.retryCount + 1;

  try {
    const body = state.sourceType === "EMAIL_IMAGE" ? "(see attached image)" : state.text;
    const prompt =
      attempt === 1 ? buildInitialPrompt(body)
      : attempt === 2 ? buildRetryPrompt(body, state.errors, attempt)
      : buildSimplifiedPrompt(body);

    const images = state.sourceType === "EMAIL_IMAGE" && state.filePath
      ? [(await fs.readFile(state.filePath)).toString("base64")]
      : undefined;

    const json = await chatJSON({ system: SYSTEM, prompt, schema: InvoiceJSONSchema, images });
    const zodResult = InvoiceSchema.safeParse(json);

    if (zodResult.success) {
      const inv = zodResult.data;
      return {
        extracted: inv,
        retryCount: attempt,
        errors: [],
        status: "EXTRACTED",
        note: `Attempt ${attempt}: ${inv.vendor.name} · ${inv.invoiceMeta.invoiceId} · ${inv.items.length} line item(s) · ${inv.invoiceMeta.currency} ${inv.totals.grandTotal}`,
      };
    }

    const zodErrors = zodResult.error.issues.map((issue) =>
      `Field "${issue.path.join(".")}": ${issue.message}`
    );
    return {
      extracted: null,
      retryCount: attempt,
      errors: zodErrors,
      status: "EXTRACT_SCHEMA_FAIL",
      note: `Attempt ${attempt}: output did not match the schema (${zodErrors.length} issue(s))`,
    };
  } catch (err: any) {
    return {
      extracted: null,
      retryCount: attempt,
      errors: [`EXTRACT error: ${err.message}`],
      status: "EXTRACT_FAILED",
      note: `Attempt ${attempt}: ${err.message}`,
    };
  }
}
