import Anthropic from '@anthropic-ai/sdk';
import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';
import { createMemory } from './memory.service';

// Sessions with a gap > 30 min between tool calls are considered separate sessions
const SESSION_GAP_MS = 30 * 60 * 1000;
// Minimum tool calls before we bother summarizing
const MIN_CALLS_FOR_SUMMARY = 3;
// How far back to look for unsummarized audit entries
const LOOKBACK_MS = 15 * 60 * 1000;

interface AuditEntry {
  id: string;
  agentId: string;
  tenantId: string;
  toolName: string;
  inputJson: unknown;
  outputJson: unknown;
  errorMessage: string | null;
  durationMs: number;
  createdAt: Date;
}

interface Session {
  agentId: string;
  tenantId: string;
  entries: AuditEntry[];
  startedAt: Date;
  endedAt: Date;
}

function groupIntoSessions(entries: AuditEntry[]): Session[] {
  const byAgent: Record<string, AuditEntry[]> = {};
  for (const e of entries) {
    const key = `${e.agentId}:${e.tenantId}`;
    (byAgent[key] ??= []).push(e);
  }

  const sessions: Session[] = [];
  for (const [key, agentEntries] of Object.entries(byAgent)) {
    const [agentId, tenantId] = key.split(':');
    const sorted = agentEntries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    let sessionEntries: AuditEntry[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].createdAt.getTime() - sorted[i - 1].createdAt.getTime();
      if (gap > SESSION_GAP_MS) {
        if (sessionEntries.length >= MIN_CALLS_FOR_SUMMARY) {
          sessions.push({
            agentId,
            tenantId,
            entries: sessionEntries,
            startedAt: sessionEntries[0].createdAt,
            endedAt: sessionEntries[sessionEntries.length - 1].createdAt,
          });
        }
        sessionEntries = [sorted[i]];
      } else {
        sessionEntries.push(sorted[i]);
      }
    }

    if (sessionEntries.length >= MIN_CALLS_FOR_SUMMARY) {
      sessions.push({
        agentId,
        tenantId,
        entries: sessionEntries,
        startedAt: sessionEntries[0].createdAt,
        endedAt: sessionEntries[sessionEntries.length - 1].createdAt,
      });
    }
  }

  return sessions;
}

async function buildSummary(session: Session): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn('[session-summarizer] ANTHROPIC_API_KEY not set — skipping LLM summary');
    return null;
  }

  const client = new Anthropic({ apiKey });

  const toolLog = session.entries
    .map(e => {
      const input = JSON.stringify(e.inputJson ?? {}).slice(0, 200);
      const status = e.errorMessage ? `error: ${e.errorMessage}` : 'ok';
      return `  ${e.toolName}(${input}) → ${status} [${e.durationMs}ms]`;
    })
    .join('\n');

  const prompt = `You are summarizing an agent work session for a persistent memory system.

Agent: ${session.agentId}
Tenant: ${session.tenantId}
Duration: ${Math.round((session.endedAt.getTime() - session.startedAt.getTime()) / 60000)} minutes
Tool calls (${session.entries.length}):
${toolLog}

Write a single concise paragraph (2-4 sentences) summarizing:
1. What the agent was working on
2. Key decisions or writes made
3. Current state / what's next (if inferable)

Be specific about content, not just tool names. No preamble.`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')
      .trim();
  } catch (err) {
    logger.error('[session-summarizer] Haiku summarization failed', { error: (err as Error).message });
    return null;
  }
}

export async function summarizeRecentSessions(prisma: PrismaClient): Promise<void> {
  const since = new Date(Date.now() - LOOKBACK_MS);

  // Find audit entries in the lookback window that aren't already summarized
  // We avoid re-summarizing by checking if a SESSION_SUMMARY memory was written
  // for this agent+tenant in the past LOOKBACK_MS window
  const entries = await prisma.mcpAuditLog.findMany({
    where: {
      createdAt: { gte: since },
      toolName: { not: 'smoke_test' },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (entries.length === 0) return;

  const sessions = groupIntoSessions(entries as AuditEntry[]);
  logger.info('[session-summarizer] Found sessions to summarize', { count: sessions.length });

  for (const session of sessions) {
    // Check if we already wrote a summary for this agent+tenant in this window
    const existing = await prisma.memoryEntry.findFirst({
      where: {
        agentId: session.agentId,
        tenantId: session.tenantId,
        sourceType: 'SESSION_SUMMARY' as any,
        createdAt: { gte: new Date(session.startedAt.getTime() - 5000) },
      },
    });

    if (existing) {
      logger.info('[session-summarizer] Session already summarized', { agentId: session.agentId });
      continue;
    }

    const summary = await buildSummary(session);
    if (!summary) continue;

    // Use a synthetic userId based on tenantId (no real user in MCP sessions)
    const syntheticUserId = `mcp:${session.tenantId}`;

    try {
      await createMemory(syntheticUserId, {
        title: `Session summary — ${session.agentId} — ${session.startedAt.toISOString().slice(0, 16)}`,
        content: summary,
        domain: 'business',
        sourceType: 'SESSION_SUMMARY',
        tags: ['session-summary', session.agentId, session.tenantId],
        importance: 0.6,
        metadata: {
          agentId: session.agentId,
          tenantId: session.tenantId,
          toolCallCount: session.entries.length,
          durationMinutes: Math.round((session.endedAt.getTime() - session.startedAt.getTime()) / 60000),
          sessionStart: session.startedAt.toISOString(),
          sessionEnd: session.endedAt.toISOString(),
        },
      }, prisma);

      logger.info('[session-summarizer] Session summary written', {
        agentId: session.agentId,
        tenantId: session.tenantId,
        toolCalls: session.entries.length,
      });
    } catch (err) {
      logger.error('[session-summarizer] Failed to write summary', { error: (err as Error).message });
    }
  }
}
