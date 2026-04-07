import Anthropic from '@anthropic-ai/sdk';
import type { PrismaClient } from '@prisma/client';
import { CORTEX_CONFIG } from '@boardroom/shared';
import { logger } from '../lib/logger';

const MODEL = 'claude-haiku-4-5-20251001'; // Haiku for cheap batch checks

export async function scanContradictions(userId: string, prisma: PrismaClient): Promise<unknown[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  // Get active projects + their linked decisions/assumptions
  const projects = await prisma.project.findMany({
    where: { userId, deletedAt: null, status: 'active' },
  });

  if (projects.length < 2) return []; // Need 2+ projects to compare

  // Get recent decisions and memories for each project (by domain matching)
  const projectContexts: { project: typeof projects[0]; context: string }[] = [];
  for (const p of projects) {
    const decisions = await prisma.decision.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    const memories = await prisma.memoryEntry.findMany({
      where: { userId, domain: p.domain, deletedAt: null, status: { not: 'ARCHIVED' } },
      orderBy: { importance: 'desc' },
      take: 5,
    });

    projectContexts.push({
      project: p,
      context: `Project: ${p.title} (${p.domain})\nDecisions: ${decisions.map(d => d.title).join(', ')}\nKey facts: ${memories.map(m => m.content.slice(0, 100)).join('; ')}`,
    });
  }

  // Compare pairs (batch 3-5 pairs per Haiku call)
  const client = new Anthropic({ apiKey });
  const pairs: string[] = [];
  for (let i = 0; i < projectContexts.length; i++) {
    for (let j = i + 1; j < projectContexts.length; j++) {
      pairs.push(`PAIR: "${projectContexts[i].project.title}" vs "${projectContexts[j].project.title}"\nA: ${projectContexts[i].context}\nB: ${projectContexts[j].context}`);
    }
  }

  if (pairs.length === 0) return [];

  // Batch pairs (max 5 per call)
  const results: unknown[] = [];
  for (let i = 0; i < pairs.length; i += 5) {
    const batch = pairs.slice(i, i + 5);
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      system: `Detect contradictions between project pairs. For each pair, check if assumptions, timelines, resource plans, or strategies conflict. Return JSON array:
[{"pairIndex": 0, "hasContradiction": true, "description": "...", "severity": "low|medium|high", "entityATitle": "...", "entityBTitle": "..."}]
If no contradiction found for a pair, omit it from the array. Only flag genuine conflicts, not minor differences.`,
      messages: [{ role: 'user', content: batch.map((p, idx) => `[${idx}] ${p}`).join('\n\n') }],
    });

    const text = response.content[0];
    if (text?.type === 'text') {
      try {
        const jsonStr = text.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const detected = JSON.parse(jsonStr) as { description: string; severity: string; entityATitle: string; entityBTitle: string }[];

        for (const d of detected) {
          // Dedup: check if similar contradiction exists
          const existing = await prisma.contradictionAlert.findFirst({
            where: { userId, status: 'ACTIVE', description: { contains: d.description.slice(0, 30) } },
          });

          if (!existing) {
            const alert = await prisma.contradictionAlert.create({
              data: {
                userId,
                description: d.description,
                entityA: { type: 'project', id: '', title: d.entityATitle },
                entityB: { type: 'project', id: '', title: d.entityBTitle },
                severity: d.severity,
                status: 'ACTIVE',
              },
            });
            results.push(alert);
          }
        }
      } catch {
        /* parse error — skip batch */
      }
    }
  }

  logger.info('Contradiction scan complete', { userId, newContradictions: results.length });
  return results;
}

export async function getContradictions(
  userId: string, status: string | undefined, limit: number, offset: number, prisma: PrismaClient
) {
  const where: Record<string, unknown> = { userId };
  if (status) where.status = status;

  const [items, total] = await Promise.all([
    prisma.contradictionAlert.findMany({ where: where as any, orderBy: { detectedAt: 'desc' }, take: limit, skip: offset }),
    prisma.contradictionAlert.count({ where: where as any }),
  ]);
  return { items, total, offset, limit };
}

export async function updateContradiction(
  id: string, status: string, resolution: string | undefined, prisma: PrismaClient
) {
  return prisma.contradictionAlert.update({
    where: { id },
    data: {
      status: status as any,
      resolution: resolution ?? null,
      resolvedAt: ['RESOLVED', 'DISMISSED'].includes(status) ? new Date() : null,
    },
  });
}
