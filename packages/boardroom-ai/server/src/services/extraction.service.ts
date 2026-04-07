import Anthropic from '@anthropic-ai/sdk';
import type { MemoryProposal } from '@boardroom/shared';
import { extractMemories, type ExtractionResult } from '../agents/memory-extractor';
import type { OmniMindClient } from './omnimind-client';
import type { SessionState } from '../agents/orchestrator';

// In-memory store for pending proposals (per session)
const pendingProposals = new Map<string, MemoryProposal[]>();

export async function proposeExtractions(
  session: SessionState,
  client: Anthropic
): Promise<ExtractionResult> {
  const result = await extractMemories(
    session.question,
    session.personaResponses,
    session.synthesis,
    client
  );

  // Store proposals for later confirmation
  pendingProposals.set(session.id, result.proposals);
  return result;
}

export async function confirmExtractions(
  sessionId: string,
  userId: string,
  accepted: number[],
  modified: { index: number; changes: Partial<MemoryProposal> }[],
  rejected: number[],
  omnimind: OmniMindClient
): Promise<{ created: number; modified: number; rejected: number }> {
  const proposals = pendingProposals.get(sessionId);
  if (!proposals) throw new Error('No pending proposals for this session');

  let created = 0;
  let modifiedCount = 0;

  // Process accepted proposals
  for (const idx of accepted) {
    const proposal = proposals[idx];
    if (!proposal) continue;
    await omnimind.createMemory(userId, {
      title: proposal.title,
      content: proposal.content,
      domain: proposal.domain,
      sourceType: 'AGENT_EXTRACTED',
      tags: proposal.tags,
      memoryClass: proposal.memoryClass,
      importance: proposal.importance,
      confidence: proposal.confidence,
      sourceRef: `session:${sessionId}`,
      metadata: proposal.metadata,
    });
    created++;
  }

  // Process modified proposals
  for (const mod of modified) {
    const proposal = proposals[mod.index];
    if (!proposal) continue;
    const merged = { ...proposal, ...mod.changes };
    await omnimind.createMemory(userId, {
      title: merged.title,
      content: merged.content,
      domain: merged.domain,
      sourceType: 'AGENT_EXTRACTED',
      tags: merged.tags,
      memoryClass: merged.memoryClass,
      importance: merged.importance,
      confidence: merged.confidence,
      sourceRef: `session:${sessionId}`,
      metadata: merged.metadata,
    });
    modifiedCount++;
  }

  // Clean up
  pendingProposals.delete(sessionId);

  return { created, modified: modifiedCount, rejected: rejected.length };
}
