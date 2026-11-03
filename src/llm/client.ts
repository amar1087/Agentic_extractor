// src/llm/client.ts
// PURPOSE: Thin client for local inference. Every agent that talks to a model
// goes through chatJSON(), which asks for output constrained to a JSON schema.
//
// Works against Ollama (native API, `format: <schema>`) or any OpenAI-compatible
// server such as vLLM (`response_format: json_schema`) — see NFR-02.

import { config } from "../config.js";

export interface ChatJSONRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  images?: string[]; // base64, no data: prefix
  model?: string;
  temperature?: number;
}

export async function chatJSON(req: ChatJSONRequest): Promise<unknown> {
  const model = req.model ?? (req.images?.length ? config.llm.visionModel : config.llm.model);
  const raw = config.llm.provider === "openai" ? await callOpenAI(req, model) : await callOllama(req, model);

  // Constrained decoding should give clean JSON, but small models occasionally
  // wrap it in prose or fences — take the outermost object.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Model response did not contain a JSON object");
  try {
    return JSON.parse(match[0]);
  } catch {
    try {
      return JSON.parse(escapeControlCharsInStrings(match[0]));
    } catch {
      throw new Error("Model returned malformed JSON");
    }
  }
}

// Models sometimes put literal newlines/tabs inside JSON strings (invalid JSON).
// Escape control characters only while inside a string literal.
function escapeControlCharsInStrings(json: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of json) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      else if (ch === "\n") { out += "\\n"; continue; }
      else if (ch === "\r") { out += "\\r"; continue; }
      else if (ch === "\t") { out += "\\t"; continue; }
    } else if (ch === '"') {
      inString = true;
    }
    out += ch;
  }
  return out;
}

async function callOllama(req: ChatJSONRequest, model: string): Promise<string> {
  const res = await fetch(`${config.llm.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: req.schema,
      options: { temperature: req.temperature ?? 0.1, top_p: 0.9 },
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt, ...(req.images?.length ? { images: req.images } : {}) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.message?.content ?? "";
}

async function callOpenAI(req: ChatJSONRequest, model: string): Promise<string> {
  const userContent = req.images?.length
    ? [
        { type: "text", text: req.prompt },
        ...req.images.map((b64) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } })),
      ]
    : req.prompt;

  const res = await fetch(`${config.llm.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.llm.apiKey ? { Authorization: `Bearer ${config.llm.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      temperature: req.temperature ?? 0.1,
      response_format: { type: "json_schema", json_schema: { name: "output", schema: req.schema } },
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

export async function llmHealth(): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    const url = config.llm.provider === "openai" ? `${config.llm.baseUrl}/v1/models` : `${config.llm.baseUrl}/api/tags`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    const models: string[] = config.llm.provider === "openai"
      ? (data.data ?? []).map((m: any) => m.id)
      : (data.models ?? []).map((m: any) => m.name);
    return { ok: res.ok, models };
  } catch (err: any) {
    return { ok: false, models: [], error: err.message };
  }
}
