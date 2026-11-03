// src/server/index.ts
// PURPOSE: API server + worker in one process for local use and demos.
//   - REST API and SSE stream under /api
//   - Gmail OAuth callback
//   - serves the built dashboard (web/dist) in production
//   - background loops: Gmail polling and the reminder agent
// In AWS the worker half (queue consumer, schedulers) runs as separate ECS tasks.

import express, { NextFunction, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { ZodError } from "zod";
import { getGraph } from "../agent/graph.js";
import { config } from "../config.js";
import { handleCallback, orgIdFromState } from "../ingestion/gmail/oauth.js";
import { syncAllMailboxes } from "../ingestion/gmail/sync.js";
import { recoverJobs } from "../queue/queue.js";
import { runReminderAgent } from "../reminders/agent.js";
import { api } from "./routes.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

app.use("/api", api);

app.get("/mailbox/oauth/google/callback", async (req, res) => {
  try {
    const orgId = orgIdFromState(String(req.query.state ?? ""));
    await handleCallback(String(req.query.code ?? ""), orgId);
    res.redirect(`${config.appUrl}/settings?gmail=connected`);
  } catch (err: any) {
    res.redirect(`${config.appUrl}/settings?gmail=error&message=${encodeURIComponent(err.message)}`);
  }
});

// Built UI (pnpm build:web) — in dev, Vite serves it on :5173 and proxies /api here
const webDist = path.resolve("web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Invalid request", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
  }
  const status = err.status ?? (err.code === "P2025" ? 404 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message ?? "Internal error" });
});

async function main() {
  await getGraph(); // creates the LangGraph checkpoint tables on first boot
  const recovered = await recoverJobs();

  app.listen(config.port, () => {
    console.log(`▶ Agentic Extractor API on http://localhost:${config.port}  (recovered ${recovered} queued job(s))`);
  });

  const every = (minutes: number, fn: () => Promise<unknown>, label: string) => {
    const run = () => fn().catch((err) => console.warn(`${label} failed: ${err.message}`));
    setTimeout(run, 10_000);
    setInterval(run, minutes * 60_000);
  };
  every(config.gmail.pollMinutes, syncAllMailboxes, "Gmail poll");
  every(config.reminderIntervalMinutes, () => runReminderAgent(), "Reminder agent");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
