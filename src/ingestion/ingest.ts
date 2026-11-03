// src/ingestion/ingest.ts
// PURPOSE: Single entry point for every ingestion path (upload, Gmail, API).
// Computes a SHA-256 content hash as the idempotency key (SRS 4.1), stores the
// document, creates the IngestionJob and enqueues it.

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";
import { prisma } from "../db/client.js";
import { publish } from "../events/bus.js";
import { enqueueJob } from "../queue/queue.js";

export interface IngestInput {
  orgId: string;
  source: "UPLOAD" | "GMAIL" | "API";
  content: Buffer | string;
  fileName?: string;
  mimeType?: string;
  externalId?: string;
  emailFrom?: string;
  emailSubject?: string;
}

const EXT: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "text/plain": ".txt",
};

export function sourceTypeFor(mimeType: string | undefined, source: IngestInput["source"]) {
  if (mimeType === "application/pdf") return "EMAIL_PDF";
  if (mimeType?.startsWith("image/")) return "EMAIL_IMAGE";
  return source === "API" ? "API" : "EMAIL_TEXT";
}

export function isSupportedMime(mimeType: string | undefined) {
  return !!mimeType && mimeType in EXT;
}

export async function ingestDocument(input: IngestInput) {
  const buffer = typeof input.content === "string" ? Buffer.from(input.content, "utf-8") : input.content;
  const mimeType = input.mimeType ?? "text/plain";
  if (!isSupportedMime(mimeType)) {
    throw Object.assign(new Error(`Unsupported file type ${mimeType} — send PDF, PNG, JPG or plain text`), { status: 415 });
  }

  const contentHash = crypto.createHash("sha256").update(buffer).digest("hex");

  // ── Idempotency: same bytes for the same org → same job ────────────────────
  const existing = await prisma.ingestionJob.findUnique({
    where: { orgId_contentHash: { orgId: input.orgId, contentHash } },
  });
  if (existing) return { job: existing, duplicate: true };

  const dir = path.join(config.storageDir, input.orgId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${contentHash}${EXT[mimeType]}`);
  await fs.writeFile(filePath, buffer);

  try {
    const job = await prisma.ingestionJob.create({
      data: {
        orgId: input.orgId,
        source: input.source,
        sourceType: sourceTypeFor(mimeType, input.source),
        fileName: input.fileName ?? null,
        filePath,
        mimeType,
        contentHash,
        externalId: input.externalId ?? null,
        emailFrom: input.emailFrom ?? null,
        emailSubject: input.emailSubject ?? null,
      },
    });
    publish({ type: "job-updated", orgId: job.orgId, jobId: job.id, status: job.status });
    enqueueJob(job.id);
    return { job, duplicate: false };
  } catch (err: any) {
    if (err.code === "P2002") {
      const job = await prisma.ingestionJob.findUniqueOrThrow({
        where: { orgId_contentHash: { orgId: input.orgId, contentHash } },
      });
      return { job, duplicate: true };
    }
    throw err;
  }
}
