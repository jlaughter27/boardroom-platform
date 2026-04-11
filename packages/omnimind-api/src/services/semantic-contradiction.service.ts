import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';

export interface SemanticContradiction {
  memoryA: { id: string; title: string; content: string };
  memoryB: { id: string; title: string; content: string };
  similarity: number;
  contradictionScore: number;
  reason: string;
}

const THRESHOLDS = {
  topicSimilarity: 0.75,
  contradiction: 0.65,
  minConfidence: 0.6,
};

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export async function detectContradictionsForMemory(
  userId: string,
  memoryId: string,
  prisma: PrismaClient
): Promise<SemanticContradiction[]> {
  const contradictions: SemanticContradiction[] = [];

  type MemoryWithEmbedding = { id: string; title: string; content: string; confidence: number; embedding: number[] | null };

  const [targetResult] = await prisma.$queryRaw<MemoryWithEmbedding[]>`
    SELECT id, title, content, confidence, embedding
    FROM memory_entries
    WHERE id = ${memoryId} AND "userId" = ${userId} AND "deletedAt" IS NULL
    LIMIT 1
  `;

  if (!targetResult?.embedding) return contradictions;
  const targetMemory = targetResult;

  const candidates = await prisma.$queryRaw<MemoryWithEmbedding[]>`
    SELECT id, title, content, confidence, embedding
    FROM memory_entries
    WHERE "userId" = ${userId}
      AND "deletedAt" IS NULL
      AND id != ${memoryId}
      AND confidence >= ${THRESHOLDS.minConfidence}
      AND embedding IS NOT NULL
      AND "createdAt" >= ${new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)}
    LIMIT 50
  `;

  const targetEmbedding = targetMemory.embedding;

  for (const candidate of candidates) {
    if (!candidate.embedding) continue;
    const candidateEmbedding = candidate.embedding;
    const similarity = cosineSimilarity(targetEmbedding as number[], candidateEmbedding);
    if (similarity < THRESHOLDS.topicSimilarity) continue;

    const score = calculateContradictionScore(targetMemory.content, candidate.content);
    if (score >= THRESHOLDS.contradiction) {
      contradictions.push({
        memoryA: { id: targetMemory.id, title: targetMemory.title, content: targetMemory.content },
        memoryB: { id: candidate.id, title: candidate.title, content: candidate.content },
        similarity: Math.round(similarity * 100) / 100,
        contradictionScore: Math.round(score * 100) / 100,
        reason: 'Semantic contradiction detected',
      });
    }
  }

  return contradictions.sort((a, b) => b.contradictionScore - a.contradictionScore);
}

function calculateContradictionScore(textA: string, textB: string): number {
  const patterns = [
    { regex: /\b(not|no|never)\b.*\b(increase|grow|more)\b/i, weight: 0.8 },
    { regex: /\b(increase|grow|more)\b.*\b(not|no|never)\b/i, weight: 0.8 },
    { regex: /\b(start|begin)\b.*\b(stop|end|cancel)\b/i, weight: 0.7 },
    { regex: /\b(yes|agree|support)\b.*\b(no|disagree|oppose)\b/i, weight: 0.9 },
  ];

  const combined = `${textA} ${textB}`.toLowerCase();
  let score = 0;
  for (const p of patterns) {
    if (p.regex.test(combined)) score += p.weight;
  }
  return Math.min(1, score);
}

export async function batchContradictionCheck(
  userId: string,
  prisma: PrismaClient,
  limit: number = 100
): Promise<{ checked: number; contradictions: number }> {
  type MemoryIdResult = { id: string };
  const recentMemories = await prisma.$queryRaw<MemoryIdResult[]>`
    SELECT id
    FROM memory_entries
    WHERE "userId" = ${userId}
      AND "deletedAt" IS NULL
      AND confidence >= ${THRESHOLDS.minConfidence}
      AND embedding IS NOT NULL
    ORDER BY "createdAt" DESC
    LIMIT ${limit}
  `;

  let totalContradictions = 0;
  for (const memory of recentMemories) {
    const results = await detectContradictionsForMemory(userId, memory.id, prisma);
    totalContradictions += results.length;
  }

  logger.info('Batch contradiction check complete', {
    userId: userId.substring(0, 10),
    checked: recentMemories.length,
    contradictions: totalContradictions,
  });

  return { checked: recentMemories.length, contradictions: totalContradictions };
}
