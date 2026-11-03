# Agentic Extractor — Invoice Manager

A multi-agent accounts-payable system. Invoices arrive by email, upload or API; a
LangGraph.js state machine of single-purpose agents extracts, audits and verifies
them with a local LLM; exceptions pause for a human; and a collections agent
reminds the finance team before and after each due date.

```
  Gmail / upload / API
          │  SHA-256 idempotency
          ▼
  Intake ─▶ Extractor ─▶ Auditor ─▶ Compliance ─▶ Ledger
  (PARSE)   (EXTRACT)  ▲ (VALIDATE)  (VERIFY)      (STORE)
                       └─ retry with feedback ┘      │
                    retries exhausted / unknown vendor / policy
                                  ▼
                       Human reviewer (interrupt, checkpointed in Postgres)
                       approve → Ledger · whitelist → Compliance · reject

  Ledger (unpaid) ──▶ Collections agent: -3d · due · +7d reminders (LLM-drafted)
```

## Run it locally

Prereqs: Docker Desktop, Node 20+, pnpm, [Ollama](https://ollama.com).

```bash
docker compose up -d                 # Postgres on :5433
ollama pull qwen2.5:7b               # extraction model (optional: qwen2.5vl:7b for images)
cp .env.example .env                 # fill JWT_SECRET, ENCRYPTION_KEY, SEED_ADMIN_PASSWORD
pnpm install
pnpm prisma migrate deploy && pnpm prisma generate
pnpm seed                            # demo org, admin user, vendor whitelist
pnpm dev                             # API on :3000 + UI on :5173
```

Open http://localhost:5173 and sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
On **Agent runs → Samples**, each sample exercises a different path through the graph
(clean, overdue, unknown vendor, arithmetic error, invoice-in-email-body).

## What's where

| Path | What |
|---|---|
| `src/agent/graph.ts` | LangGraph wiring, PostgresSaver checkpointer, per-node telemetry |
| `src/agent/nodes/*` | The agents: parse, extract, validate, verify, hitl, store, rejected |
| `src/validation/` | Zod schema (LLM contract) and the Decimal.js rule engine |
| `src/ingestion/` | Idempotent ingestion; Gmail OAuth, polling and attachment pull |
| `src/reminders/` | Collections agent and mailer (Gmail → SMTP → preview fallback) |
| `src/server/` | Express API, SSE live stream, auth, background schedulers |
| `web/` | React + Vite + Tailwind dashboard |
| `samples/` | Demo invoices; `{{DATE:+5}}` placeholders are relative to today |

## API (all under `/api`, JWT cookie or `Authorization: Bearer`)

`POST /ingest` (multipart `file` or JSON `{text}`) · `GET /jobs/:id` · `GET /review` ·
`POST /review/:jobId/decision` `{action: APPROVE|REJECT|APPROVE_AND_WHITELIST, corrected?, reason?}` ·
`GET /invoices` · `POST /invoices/:id/payment` · `POST /invoices/:id/remind` · `POST /reminders/run` ·
`GET|PUT /config` · `GET /events/stream` (SSE)

## Gmail

Create an OAuth client (Web application) in Google Cloud, add
`http://localhost:3000/mailbox/oauth/google/callback` as a redirect URI, put the
client ID/secret in `.env`, then **Settings → Connect Gmail**. Scopes: `gmail.readonly`
(find invoices) and `gmail.send` (reminders). Without a mailbox or SMTP, reminders are
drafted and shown in the outbox but not emailed.
