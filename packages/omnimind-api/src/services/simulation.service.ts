import type { PrismaClient } from '@prisma/client';
import { SimulationLLMResponseSchema, MODEL_IDS } from '@boardroom/shared';
import { logger } from '../lib/logger';
import { loadSystemPrompt } from '../lib/prompt-loader';
import { createMessage, extractText, parseJsonFromText, hasAnthropicKey } from '../lib/anthropic';

export async function runSimulation(
  userId: string,
  chosenPath: string,
  sessionQuestion: string,
  prisma: PrismaClient
) {
  if (!hasAnthropicKey()) throw new Error('ANTHROPIC_API_KEY not set');

  // Gather user's current state
  const [goals, projects, tasks, people, recentDecisions] = await Promise.all([
    prisma.goal.findMany({ where: { userId, deletedAt: null, status: 'active' }, take: 10 }),
    prisma.project.findMany({ where: { userId, deletedAt: null, status: 'active' }, take: 10 }),
    prisma.task.findMany({ where: { userId, deletedAt: null, status: { not: 'done' } }, take: 20 }),
    prisma.person.findMany({ where: { userId, deletedAt: null }, take: 10 }),
    prisma.decision.findMany({ where: { userId, outcome: { not: null } }, orderBy: { createdAt: 'desc' }, take: 5 }),
  ]);

  const context = `## Decision
Question: ${sessionQuestion}
Chosen path: ${chosenPath}

## Current Goals
${goals.map(g => `- ${g.title} (${g.status})${g.deadline ? ` due ${g.deadline.toISOString().split('T')[0]}` : ''}`).join('\n') || 'None'}

## Active Projects
${projects.map(p => `- ${p.title} (${p.status})${p.deadline ? ` due ${p.deadline.toISOString().split('T')[0]}` : ''}`).join('\n') || 'None'}

## Open Tasks (${tasks.length})
${tasks.slice(0, 10).map(t => `- ${t.title}${t.owner ? ` [${t.owner}]` : ''}${t.deadline ? ` due ${t.deadline.toISOString().split('T')[0]}` : ''}`).join('\n') || 'None'}

## Key People
${people.map(p => `- ${p.name}${p.role ? ` (${p.role})` : ''}`).join('\n') || 'None'}

## Past Decision Outcomes
${recentDecisions.map(d => `- "${d.title}": ${d.outcome} (${d.outcomeRating}/5)`).join('\n') || 'None'}`;

  // Prompt via the shared loader (walks up to docs/prompts in dev + Docker).
  let systemPrompt: string;
  try {
    systemPrompt = loadSystemPrompt('cortex-simulation');
  } catch {
    systemPrompt = 'You are a decision simulation engine. Return structured JSON with resourceImpact, timelineImpact, stakeholderImpact, and overallRisk.';
  }

  logger.info('Running simulation', { userId, chosenPath: chosenPath.slice(0, 100) });

  // Phase 6: shared client, MODEL_IDS, explicit effort, usage recorded.
  const response = await createMessage({
    model: MODEL_IDS.sonnet,
    max_tokens: 2000,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: context }],
    output_config: { effort: 'medium' },
  }, { purpose: 'cortex-simulation', userId });

  const text = extractText(response);
  if (!text) throw new Error('Empty simulation response');
  return SimulationLLMResponseSchema.parse(parseJsonFromText(text));
}
