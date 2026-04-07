import Anthropic from '@anthropic-ai/sdk';
import type { PrismaClient } from '@prisma/client';
import { SimulationLLMResponseSchema } from '@boardroom/shared';
import { logger } from '../lib/logger';

const MODEL = 'claude-sonnet-4-6-20250514';

export async function runSimulation(
  userId: string,
  chosenPath: string,
  sessionQuestion: string,
  prisma: PrismaClient
) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

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

  const client = new Anthropic({ apiKey });
  // Load simulation prompt
  const { readFileSync } = await import('fs');
  const { resolve } = await import('path');
  const promptPath = resolve(__dirname, '../../../../docs/prompts/cortex-simulation.system.md');
  let systemPrompt: string;
  try {
    systemPrompt = readFileSync(promptPath, 'utf-8');
  } catch {
    systemPrompt = 'You are a decision simulation engine. Return structured JSON with resourceImpact, timelineImpact, stakeholderImpact, and overallRisk.';
  }

  logger.info('Running simulation', { userId, chosenPath: chosenPath.slice(0, 100) });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: context }],
  });

  const text = response.content[0];
  if (!text || text.type !== 'text') throw new Error('Empty simulation response');
  const jsonStr = text.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return SimulationLLMResponseSchema.parse(JSON.parse(jsonStr));
}
