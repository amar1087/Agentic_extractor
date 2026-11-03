// src/reminders/mailer.ts
// PURPOSE: Outbound email with graceful fallback:
//   1. the org's connected Gmail mailbox (if it granted gmail.send)
//   2. SMTP (SMTP_HOST etc. in env)
//   3. PREVIEW — nothing is sent; the message is kept as a draft in the UI

import nodemailer from "nodemailer";
import { config } from "../config.js";
import { gmailForOrg } from "../ingestion/gmail/oauth.js";

export interface OutboundMail {
  to: string[];
  subject: string;
  body: string;
}

export type Channel = "GMAIL" | "SMTP" | "PREVIEW";

export async function activeChannel(orgId: string): Promise<Channel> {
  const client = await gmailForOrg(orgId).catch(() => null);
  if (client?.conn.canSend) return "GMAIL";
  if (config.smtp.host) return "SMTP";
  return "PREVIEW";
}

export async function sendMail(orgId: string, mail: OutboundMail): Promise<{ channel: Channel; status: "SENT" | "DRAFTED" }> {
  const channel = await activeChannel(orgId);

  if (channel === "GMAIL") {
    const { gmail, conn } = (await gmailForOrg(orgId))!;
    const raw = [
      `From: ${conn.emailAddress}`,
      `To: ${mail.to.join(", ")}`,
      `Subject: =?UTF-8?B?${Buffer.from(mail.subject).toString("base64")}?=`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      mail.body,
    ].join("\r\n");
    await gmail.users.messages.send({ userId: "me", requestBody: { raw: Buffer.from(raw).toString("base64url") } });
    return { channel, status: "SENT" };
  }

  if (channel === "SMTP") {
    const transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
    await transport.sendMail({ from: config.smtp.from ?? config.smtp.user, to: mail.to, subject: mail.subject, text: mail.body });
    return { channel, status: "SENT" };
  }

  return { channel, status: "DRAFTED" };
}
