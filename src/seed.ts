// src/seed.ts
// PURPOSE: Creates (or tops up) a demo organisation, its admin user, tenant
// config and a starter vendor whitelist. Safe to run repeatedly.
//   pnpm seed

import { hashPassword } from "./auth/session.js";
import { prisma } from "./db/client.js";

const ORG_ID = process.env.SEED_ORG_ID ?? "test-org-001";
const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@demo.test").toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD;

async function main() {
  if (!password) throw new Error("Set SEED_ADMIN_PASSWORD in .env before seeding");

  const org = await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: { id: ORG_ID, name: "Demo Organisation", billingEmail: "ap@demo.test", plan: "pro" },
  });

  await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hashPassword(password) },
    create: { orgId: org.id, email, name: "Demo Admin", role: "admin", passwordHash: hashPassword(password) },
  });

  await prisma.tenantConfig.upsert({
    where: { orgId: org.id },
    update: {},
    create: {
      orgId: org.id,
      reviewerEmails: [],
      supportedCurrencies: [],
      reminderRecipients: [org.billingEmail],
      defaultCurrency: "USD",
    },
  });

  for (const vendorName of ["Acme Corporation", "Northwind Cloud Services", "Globex Logistics"]) {
    await prisma.vendorWhitelist.upsert({
      where: { orgId_vendorName: { orgId: org.id, vendorName } },
      update: {},
      create: { orgId: org.id, vendorName, approvedBy: "seed" },
    });
  }

  console.log(`Seeded org "${org.name}" (${org.id}) — sign in as ${email} with SEED_ADMIN_PASSWORD from .env`);
}

main().finally(() => prisma.$disconnect());
