import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import { decrypt, encrypt } from '../../auth/crypto.js';
import { config } from '../../config.js';
import { prisma } from '../../db/client.js';

// gmail.readonly to ingest invoices, gmail.send so the reminder agent can
// send from the connected mailbox
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];

export function isGmailConfigured() {
  return !!(config.gmail.clientId && config.gmail.clientSecret);
}

function newOAuthClient() {
  return new google.auth.OAuth2(config.gmail.clientId, config.gmail.clientSecret, config.gmail.redirectUri);
}

// Step 1: redirect the org admin here to grant access.
// `state` is a short-lived signed token, so the callback cannot be pointed at another org.
export function getConsentUrl(orgId: string) {
  return newOAuthClient().generateAuthUrl({
    access_type: 'offline',       // required to get a refresh token
    prompt: 'consent',
    scope: SCOPES,
    state: jwt.sign({ orgId, purpose: 'gmail-oauth' }, config.jwtSecret, { expiresIn: '10m' }),
  });
}

export function orgIdFromState(state: string): string {
  const payload = jwt.verify(state, config.jwtSecret) as { orgId: string; purpose: string };
  if (payload.purpose !== 'gmail-oauth') throw new Error('Invalid OAuth state');
  return payload.orgId;
}

// Step 2: handle the redirect back from Google
export async function handleCallback(code: string, orgId: string) {
  const oauth2Client = newOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh token — remove the app at myaccount.google.com/permissions and reconnect');
  }
  oauth2Client.setCredentials(tokens);
  const { data: profile } = await google.gmail({ version: 'v1', auth: oauth2Client })
    .users.getProfile({ userId: 'me' });

  const canSend = (tokens.scope ?? '').includes('gmail.send');
  const refreshTokenEnc = await encrypt(tokens.refresh_token);

  await prisma.mailboxConnection.upsert({
    where: { orgId },
    create: {
      orgId, provider: 'gmail', emailAddress: profile.emailAddress!,
      refreshTokenEnc, canSend,
      historyId: String(profile.historyId), status: 'ACTIVE',
    },
    update: {
      emailAddress: profile.emailAddress!,
      refreshTokenEnc, canSend,
      status: 'ACTIVE',
    },
  });
}

// Authorised Gmail API client for an org's connected mailbox
export async function gmailForOrg(orgId: string) {
  const conn = await prisma.mailboxConnection.findUnique({ where: { orgId } });
  if (!conn || conn.status !== 'ACTIVE') return null;
  const oauth2Client = newOAuthClient();
  oauth2Client.setCredentials({ refresh_token: await decrypt(conn.refreshTokenEnc) });
  return { gmail: google.gmail({ version: 'v1', auth: oauth2Client }), conn };
}

export async function markNeedsReauth(orgId: string) {
  await prisma.mailboxConnection.update({ where: { orgId }, data: { status: 'NEEDS_REAUTH' } });
}
