import { google } from 'googleapis';
import Anthropic from '@anthropic-ai/sdk';
import type { EmailSummary, EmailExtraction, EmailMemoryProposal } from '@boardroom/shared';
import { MODEL_MAP, EmailMemoryProposalsSchema } from '@boardroom/shared';
import { omnimindClient } from './omnimind-client';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI
  ? process.env.GOOGLE_REDIRECT_URI.replace('/calendar/callback', '/integrations/gmail/callback')
  : 'http://localhost:3001/integrations/gmail/callback';

function isConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

function createOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

export function getAuthUrl(userId: string): string | null {
  if (!isConfigured()) return null;
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    state: `gmail:${userId}`,
    prompt: 'consent',
  });
}

export async function handleCallback(userId: string, code: string): Promise<void> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  await omnimindClient.saveOAuthToken(userId, {
    provider: 'gmail',
    accessToken: tokens.access_token ?? '',
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    scope: 'gmail.readonly',
    calendarId: null,
  });
}

async function getGmailClient(userId: string) {
  const tokenData = await omnimindClient.getOAuthToken(userId, 'gmail') as Record<string, unknown> | null;
  if (!tokenData) return null;
  const client = createOAuth2Client();
  client.setCredentials({
    access_token: tokenData.accessToken as string,
    refresh_token: tokenData.refreshToken as string | undefined,
    expiry_date: tokenData.expiresAt ? new Date(tokenData.expiresAt as string).getTime() : undefined,
  });
  // Auto-refresh
  client.on('tokens', async (newTokens) => {
    if (newTokens.access_token) {
      await omnimindClient.saveOAuthToken(userId, {
        provider: 'gmail',
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token ?? (tokenData.refreshToken as string | null),
        expiresAt: newTokens.expiry_date ? new Date(newTokens.expiry_date).toISOString() : null,
        scope: 'gmail.readonly',
        calendarId: null,
      });
    }
  });
  return google.gmail({ version: 'v1', auth: client });
}

export async function getRecentEmails(userId: string, maxResults: number = 20): Promise<EmailSummary[]> {
  const gmail = await getGmailClient(userId);
  if (!gmail) return [];

  try {
    // Only PRIMARY and UPDATES categories, last 7 days
    const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: `category:primary OR category:updates after:${sevenDaysAgo}`,
    });

    const messages = response.data.messages ?? [];
    const summaries: EmailSummary[] = [];

    for (const msg of messages.slice(0, maxResults)) {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
      });

      const headers = detail.data.payload?.headers ?? [];
      summaries.push({
        emailId: msg.id!,
        subject: headers.find(h => h.name === 'Subject')?.value ?? 'No subject',
        from: headers.find(h => h.name === 'From')?.value ?? 'Unknown',
        date: new Date(headers.find(h => h.name === 'Date')?.value ?? ''),
        snippet: detail.data.snippet ?? '',
      });
    }

    return summaries;
  } catch {
    return [];
  }
}

export async function extractMemoriesFromEmail(userId: string, emailId: string): Promise<EmailExtraction> {
  const gmail = await getGmailClient(userId);
  if (!gmail) throw new Error('Gmail not connected');

  // Get full email content
  const detail = await gmail.users.messages.get({ userId: 'me', id: emailId, format: 'full' });
  const headers = detail.data.payload?.headers ?? [];
  const subject = headers.find(h => h.name === 'Subject')?.value ?? 'No subject';
  const from = headers.find(h => h.name === 'From')?.value ?? 'Unknown';
  const dateStr = headers.find(h => h.name === 'Date')?.value ?? '';

  // Extract body text
  let body = '';
  const parts = detail.data.payload?.parts ?? [];
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      body += Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
  }
  if (!body && detail.data.payload?.body?.data) {
    body = Buffer.from(detail.data.payload.body.data, 'base64').toString('utf-8');
  }
  body = body.slice(0, 5000); // limit

  // Extract memories using Haiku
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const { readFileSync } = await import('fs');
  const { resolve } = await import('path');
  let systemPrompt: string;
  try {
    systemPrompt = readFileSync(resolve(__dirname, '../../../../../docs/prompts/email-extractor.system.md'), 'utf-8');
  } catch {
    systemPrompt = 'Extract important information from this email. Return JSON array of memory proposals.';
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: MODEL_MAP.haiku,
    max_tokens: 1000,
    system: systemPrompt,
    messages: [{ role: 'user', content: `Subject: ${subject}\nFrom: ${from}\nDate: ${dateStr}\n\n${body}` }],
  });

  const text = response.content[0];
  let proposals: EmailMemoryProposal[] = [];
  if (text?.type === 'text') {
    try {
      const jsonStr = text.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      proposals = EmailMemoryProposalsSchema.parse(JSON.parse(jsonStr));
    } catch { /* parse or validation error */ }
  }

  return { emailId, subject, from, date: new Date(dateStr), proposedMemories: proposals };
}

export async function getStatus(userId: string) {
  if (!isConfigured()) return { type: 'gmail' as const, status: 'disconnected' as const, error: 'Not configured' };
  const token = await omnimindClient.getOAuthToken(userId, 'gmail') as Record<string, unknown> | null;
  return {
    type: 'gmail' as const,
    status: (token ? 'connected' : 'disconnected') as 'connected' | 'disconnected',
    lastSyncAt: token?.updatedAt ? new Date(token.updatedAt as string) : null,
    error: null,
  };
}

export async function disconnect(userId: string): Promise<void> {
  await omnimindClient.deleteOAuthToken(userId, 'gmail');
}

export { isConfigured };
