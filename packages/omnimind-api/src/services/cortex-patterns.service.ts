import Anthropic from '@anthropic-ai/sdk';
import type { PrismaClient } from '@prisma/client';
import { CORTEX_CONFIG, DetectedPatternsLLMSchema } from '@boardroom/shared';
import { logger } from '../lib/logger';

const MODEL = 'claude-sonnet-4-6-20250514';

export async function detectPatterns(userId: string, prisma: PrismaClient): Promise<unknown[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  // Check threshold
  const decisionCount = await prisma.decision.count({ where: { userId } });
  if (decisionCount < CORTEX_CONFIG.minSessionsForPatterns) {
    return [];
  }

  // Fetch decision history (last 90 days)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const decisions = await prisma.decision.findMany({
    where: { userId, createdAt: { gte: ninetyDaysAgo } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const context = decisions.map(d =>
    `- ${d.title} (${d.status}): ${d.rationale ?? 'no rationale recorded'}${d.outcome ? ` → Outcome: ${d.outcome} (${d.outcomeRating}/5)` : ''}`
  ).join('\n');

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: `Analyze decision history for thinking patterns. Return JSON array:
[{"pattern": "description", "patternType": "BIAS|STRENGTH|BEHAVIORAL_CYCLE|DECISION_STYLE", "confidence": 0.0-1.0, "evidence": "brief evidence"}]
Types:
- BIAS: systematic errors (e.g., "Underestimates timelines by ~40%")
- STRENGTH: consistent good judgment (e.g., "Strong instinct for market timing")
- BEHAVIORAL_CYCLE: recurring patterns (e.g., "Q1 budget anxiety, Q3 growth push")
- DECISION_STYLE: how they decide (e.g., "Decides quickly on people, deliberates on strategy")
Be specific. Reference actual decisions. Min confidence ${CORTEX_CONFIG.patternConfidenceThreshold}.`,
    messages: [{ role: 'user', content: `## Decision History (last 90 days)\n${context}` }],
  });

  const text = response.content[0];
  if (!text || text.type !== 'text') return [];
  const jsonStr = text.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const detected = DetectedPatternsLLMSchema.parse(JSON.parse(jsonStr));

  // Upsert patterns
  const results = [];
  for (const p of detected) {
    if (p.confidence < CORTEX_CONFIG.patternConfidenceThreshold) continue;

    // Check if similar pattern exists (simple substring match)
    const existing = await prisma.thinkingPattern.findFirst({
      where: { userId, pattern: { contains: p.pattern.slice(0, 30) } },
    });

    if (existing) {
      const updated = await prisma.thinkingPattern.update({
        where: { id: existing.id },
        data: { evidenceCount: { increment: 1 }, lastDetected: new Date(), confidence: Math.max(existing.confidence, p.confidence) },
      });
      results.push(updated);
    } else {
      const created = await prisma.thinkingPattern.create({
        data: { userId, pattern: p.pattern, patternType: p.patternType, confidence: p.confidence },
      });
      results.push(created);
    }
  }

  logger.info('Pattern detection complete', { userId, patternsFound: results.length });
  return results;
}

export async function getPatterns(userId: string, limit: number, offset: number, prisma: PrismaClient) {
  const [items, total] = await Promise.all([
    prisma.thinkingPattern.findMany({ where: { userId }, orderBy: { confidence: 'desc' }, take: limit, skip: offset }),
    prisma.thinkingPattern.count({ where: { userId } }),
  ]);
  return { items, total, offset, limit };
}
