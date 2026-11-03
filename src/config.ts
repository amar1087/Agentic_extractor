// src/config.ts
// PURPOSE: Single place where environment variables are read.
// In AWS these come from Secrets Manager (injected into the task env by ECS);
// locally they come from .env.

import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} — see .env.example`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  appUrl: process.env.APP_URL ?? "http://localhost:5173",
  jwtSecret: required("JWT_SECRET"),
  storageDir: path.resolve(process.env.STORAGE_DIR ?? "storage"),

  llm: {
    // 'ollama' → native /api/chat with JSON-schema constrained output
    // 'openai' → any OpenAI-compatible server (vLLM, Ollama /v1, ...)
    provider: (process.env.LLM_PROVIDER ?? "ollama") as "ollama" | "openai",
    baseUrl: (process.env.LLM_BASE_URL ?? "http://localhost:11434").replace(/\/$/, ""),
    model: process.env.LLM_MODEL ?? "qwen2.5:7b",
    visionModel: process.env.LLM_VISION_MODEL ?? "qwen2.5vl:7b",
    apiKey: process.env.LLM_API_KEY,
    concurrency: Number(process.env.LLM_CONCURRENCY ?? 1),
  },

  gmail: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/mailbox/oauth/google/callback",
    pollMinutes: Number(process.env.GMAIL_POLL_MINUTES ?? 5),
  },

  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM,
  },

  reminderIntervalMinutes: Number(process.env.REMINDER_INTERVAL_MINUTES ?? 60),
};
