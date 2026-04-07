import type { SessionState } from '../agents/orchestrator';

export interface ExportedSession {
  question: string;
  mode: string;
  perspectives: Record<string, unknown>;
  synthesis: unknown | null;
  actionItems: string[];
  assumptions: { assumption: string; reviewAt: string | null }[];
  createdAt: string;
  exportedAt: string;
}

/**
 * Export a decision session as a structured JSON package.
 */
export function exportSession(session: SessionState): ExportedSession {
  const perspectives: Record<string, unknown> = {};
  for (const [personaId, response] of session.personaResponses) {
    perspectives[personaId] = response;
  }

  const actionItems = session.synthesis?.nextActions ?? [];
  const assumptions = session.synthesis?.assumptionsToMonitor?.map(a => ({
    assumption: a.assumption,
    reviewAt: a.reviewAt instanceof Date ? a.reviewAt.toISOString() : a.reviewAt ?? null,
  })) ?? [];

  return {
    question: session.question,
    mode: session.mode,
    perspectives,
    synthesis: session.synthesis,
    actionItems,
    assumptions,
    createdAt: new Date().toISOString(),
    exportedAt: new Date().toISOString(),
  };
}
