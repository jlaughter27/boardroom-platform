import type { PrismaClient, Prisma } from '@prisma/client';
import { CORTEX_CONFIG, ContradictionDetectionsLLMSchema, MODEL_IDS } from '@boardroom/shared';
import { logger } from '../lib/logger';
import { loadSystemPrompt } from '../lib/prompt-loader';
import { createMessage, extractText, parseJsonFromText, hasAnthropicKey } from '../lib/anthropic';

export async function scanContradictions(userId: string, prisma: PrismaClient): Promise<unknown[]> {
  if (!hasAnthropicKey()) throw new Error('ANTHROPIC_API_KEY not set');

  // Get active projects + their linked decisions/assumptions
  const projects = await prisma.project.findMany({
    where: { userId, deletedAt: null, status: 'active' },
  });

  if (projects.length < 2) return []; // Need 2+ projects to compare

  // Get recent decisions and memories for each project (by domain matching)
  const projectContexts: { project: typeof projects[0]; context: string }[] = [];
  for (const p of projects) {
    const decisions = await prisma.decision.findMany({
      where: { userId, deletedAt: null, projectLinks: { some: { projectId: p.id } } },
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
    // Phase 6: shared client, MODEL_IDS.haiku (no thinking), explicit effort, usage recorded.
    const response = await createMessage({
      model: MODEL_IDS.haiku,
      max_tokens: 1000,
      system: [{ type: 'text', text: loadSystemPrompt('cortex-contradictions'), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: batch.map((p, idx) => `[${idx}] ${p}`).join('\n\n') }],
      output_config: { effort: 'low' },
    }, { purpose: 'cortex-contradictions', userId });

    const text = extractText(response);
    if (text) {
      try {
        const detected = ContradictionDetectionsLLMSchema.parse(parseJsonFromText(text));

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
  const where: Prisma.ContradictionAlertWhereInput = { userId };
  if (status) where.status = status as Prisma.ContradictionAlertWhereInput['status'];

  const [items, total] = await Promise.all([
    prisma.contradictionAlert.findMany({ where, orderBy: { detectedAt: 'desc' }, take: limit, skip: offset }),
    prisma.contradictionAlert.count({ where }),
  ]);
  return { items, total, offset, limit };
}

export async function updateContradiction(
  id: string, userId: string, status: string, resolution: string | undefined, prisma: PrismaClient
) {
  // Verify ownership
  const existing = await prisma.contradictionAlert.findFirst({ where: { id, userId } });
  if (!existing) throw Object.assign(new Error('Not found'), { status: 404 });

  return prisma.contradictionAlert.update({
    where: { id },
    data: {
      status: status as Prisma.ContradictionAlertUpdateInput['status'],
      resolution: resolution ?? null,
      resolvedAt: ['RESOLVED', 'DISMISSED'].includes(status) ? new Date() : null,
    },
  });
}
