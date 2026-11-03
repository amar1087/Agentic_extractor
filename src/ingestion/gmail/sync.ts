// src/ingestion/gmail/sync.ts
// PURPOSE: Intake agent for Gmail. Finds invoice-looking messages since the
// last sync, pulls PDF / image attachments (or the body when there are none)
// and hands each one to ingestDocument(). Content-hash idempotency makes
// re-syncing the same window safe.

import type { gmail_v1 } from 'googleapis';
import { prisma } from '../../db/client.js';
import { publish } from '../../events/bus.js';
import { ingestDocument, isSupportedMime } from '../ingest.js';
import { gmailForOrg, markNeedsReauth } from './oauth.js';

const QUERY = '(subject:(invoice OR bill OR "payment due" OR statement) OR filename:pdf) -in:sent -in:chats';
const FIRST_SYNC_DAYS = 30;

function header(msg: gmail_v1.Schema$Message, name: string) {
  return msg.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
}

function flattenParts(part: gmail_v1.Schema$MessagePart | undefined): gmail_v1.Schema$MessagePart[] {
  if (!part) return [];
  return [part, ...(part.parts ?? []).flatMap(flattenParts)];
}

const decode = (data: string) => Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export async function syncGmail(orgId: string) {
  const client = await gmailForOrg(orgId);
  if (!client) return { imported: 0, skipped: 0, scanned: 0, connected: false };
  const { gmail, conn } = client;

  const since = conn.lastSyncedAt ?? new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000);
  // Gmail's after: is second-granular; go back 1h to tolerate clock skew (hashes dedupe)
  const after = Math.floor(since.getTime() / 1000) - 3600;
  const syncStartedAt = new Date();

  let imported = 0, skipped = 0, scanned = 0;
  let pageToken: string | undefined;

  try {
    do {
      const list = await gmail.users.messages.list({ userId: 'me', q: `${QUERY} after:${after}`, maxResults: 50, pageToken });
      pageToken = list.data.nextPageToken ?? undefined;

      for (const ref of list.data.messages ?? []) {
        scanned++;
        const { data: msg } = await gmail.users.messages.get({ userId: 'me', id: ref.id!, format: 'full' });
        const meta = { emailFrom: header(msg, 'From'), emailSubject: header(msg, 'Subject') };
        const parts = flattenParts(msg.payload);

        const attachments = parts.filter((p) => p.filename && p.body?.attachmentId && isSupportedMime(p.mimeType ?? undefined) && p.mimeType !== 'text/plain');
        for (const part of attachments) {
          const { data: att } = await gmail.users.messages.attachments.get({ userId: 'me', messageId: msg.id!, id: part.body!.attachmentId! });
          const result = await ingestDocument({
            orgId, source: 'GMAIL', content: decode(att.data!), mimeType: part.mimeType!,
            fileName: part.filename!, externalId: `${msg.id}:${part.partId}`, ...meta,
          });
          result.duplicate ? skipped++ : imported++;
        }

        // No attachment — the invoice may be in the body itself
        if (attachments.length === 0 && /invoice|bill|payment due/i.test(meta.emailSubject ?? '')) {
          const textPart = parts.find((p) => p.mimeType === 'text/plain' && p.body?.data);
          if (textPart) {
            const text = decode(textPart.body!.data!).toString('utf-8');
            const result = await ingestDocument({
              orgId, source: 'GMAIL', content: `Subject: ${meta.emailSubject}\nFrom: ${meta.emailFrom}\n\n${text}`,
              mimeType: 'text/plain', fileName: `${meta.emailSubject ?? 'email'}.txt`, externalId: msg.id!, ...meta,
            });
            result.duplicate ? skipped++ : imported++;
          }
        }
      }
    } while (pageToken);
  } catch (err: any) {
    if (err.code === 401 || /invalid_grant/.test(err.message)) await markNeedsReauth(orgId);
    throw err;
  }

  await prisma.mailboxConnection.update({ where: { orgId }, data: { lastSyncedAt: syncStartedAt } });
  publish({ type: 'mailbox-synced', orgId, imported });
  return { imported, skipped, scanned, connected: true };
}

export async function syncAllMailboxes() {
  const conns = await prisma.mailboxConnection.findMany({ where: { status: 'ACTIVE' } });
  for (const c of conns) {
    await syncGmail(c.orgId).catch((err) => console.warn(`Gmail sync failed for ${c.orgId}: ${err.message}`));
  }
}
