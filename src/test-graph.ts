// src/test-graph.ts
// Run this to test the entire graph end-to-end locally
// with a fake invoice — no email, AWS or API server needed.
//   pnpm test:graph

import crypto from "crypto";
import { runJob } from "./agent/graph.js";
import { prisma } from "./db/client.js";

const fakeInvoice = `
INVOICE

From: Acme Corporation
Tax ID: 12-3456789
Address: 123 Business Street, New York, NY 10001
Email: billing@acme.com

Invoice Number: INV-SMOKE-${Date.now()}
Issue Date: ${new Date().toISOString().slice(0, 10)}
Currency: USD

Items:
1. Web Development Services    Qty: 10   Unit Price: $100.00   Total: $1,000.00
2. Hosting Setup               Qty: 1    Unit Price: $200.00   Total: $200.00
3. Domain Registration         Qty: 2    Unit Price: $25.00    Total: $50.00

Subtotal: $1,250.00
Tax (10%): $125.00
Grand Total: $1,375.00
`;

async function main() {
  console.log("🚀 Starting invoice processing...\n");

  const fs = await import("fs/promises");
  const filePath = `storage/smoke-${Date.now()}.txt`;
  await fs.mkdir("storage", { recursive: true });
  await fs.writeFile(filePath, fakeInvoice);

  const job = await prisma.ingestionJob.create({
    data: {
      orgId: "test-org-001",
      source: "API",
      sourceType: "EMAIL_TEXT",
      filePath,
      mimeType: "text/plain",
      contentHash: crypto.createHash("sha256").update(fakeInvoice).digest("hex"),
      fileName: "smoke-test.txt",
    },
  });

  const { paused, state } = await runJob(job.id);
  console.log("\n✅ Graph finished", paused ? "(paused for human review)" : "");
  console.log("Final status:", state.status);
  console.log("Errors:", state.errors);
  if (state.extracted) console.log("\n📄 Extracted invoice:\n", JSON.stringify(state.extracted, null, 2));
}

main()
  .catch((err) => console.error("❌ Graph failed:", err))
  .finally(() => prisma.$disconnect());
