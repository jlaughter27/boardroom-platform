import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';

/**
 * Graph visualization data for memory relationships and contradictions
 */

export interface MemoryNode {
  id: string;
  type: 'memory' | 'person' | 'project' | 'goal' | 'decision';
  label: string;
  importance: number;
  confidence: number;
  domain: string;
  status: string;
  metadata: {
    hasContradictions: boolean;
    linkedEntities: number;
  };
}

export interface MemoryEdge {
  id: string;
  source: string;
  target: string;
  type: 'links_to' | 'contradicts' | 'similar_to' | 'influences';
  strength: number;
  label?: string;
}

export interface MemoryGraph {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  clusters: {
    id: string;
    label: string;
    nodes: string[];
  }[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    contradictions: number;
    isolatedNodes: number;
  };
}

/**
 * Build memory graph for visualization
 */
export async function buildMemoryGraph(
  userId: string,
  prisma: PrismaClient,
  options?: {
    limit?: number;
    since?: Date;
    includeContradictions?: boolean;
    minSimilarity?: number;
  }
): Promise<MemoryGraph> {
  const limit = options?.limit ?? 100;
  const since = options?.since ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const includeContradictions = options?.includeContradictions ?? true;
  const minSimilarity = options?.minSimilarity ?? 0.8;

  const nodes: MemoryNode[] = [];
  const edges: MemoryEdge[] = [];
  const nodeIds = new Set<string>();

  // Get memories
  const memories = await prisma.memoryEntry.findMany({
    where: {
      userId,
      deletedAt: null,
      createdAt: { gte: since },
    },
    orderBy: { importance: 'desc' },
    take: limit,
    include: {
      entityLinks: true,
    },
  });

  // Add memory nodes
  for (const memory of memories) {
    nodes.push({
      id: memory.id,
      type: 'memory',
      label: memory.title,
      importance: memory.importance,
      confidence: typeof memory.confidence === 'string' ? parseFloat(memory.confidence) || 0.5 : memory.confidence,
      domain: memory.domain,
      status: memory.status,
      metadata: {
        hasContradictions: false, // Will update later
        linkedEntities: memory.entityLinks.length,
      },
    });
    nodeIds.add(memory.id);
  }

  // Get linked entities
  const entityLinks = memories.flatMap((m: typeof memories[0]) => m.entityLinks);
  const entityIds = {
    person: new Set<string>(),
    project: new Set<string>(),
    goal: new Set<string>(),
    decision: new Set<string>(),
  };

  for (const link of entityLinks) {
    entityIds[link.entityType as keyof typeof entityIds]?.add(link.entityId);
  }

  // Fetch entities
  const [people, projects, goals, decisions] = await Promise.all([
    prisma.person.findMany({
      where: { id: { in: [...entityIds.person] }, userId },
      select: { id: true, name: true, importance: true },
    }),
    prisma.project.findMany({
      where: { id: { in: [...entityIds.project] }, userId },
      select: { id: true, title: true },
    }),
    prisma.goal.findMany({
      where: { id: { in: [...entityIds.goal] }, userId },
      select: { id: true, title: true },
    }),
    prisma.decision.findMany({
      where: { id: { in: [...entityIds.decision] }, userId },
      select: { id: true, title: true },
    }),
  ]);

  // Add entity nodes
  for (const person of people) {
    if (!nodeIds.has(person.id)) {
      nodes.push({
        id: person.id,
        type: 'person',
        label: person.name,
        importance: person.importance ?? 0.5,
        confidence: 1,
        domain: 'people',
        status: 'active',
        metadata: { hasContradictions: false, linkedEntities: 0 },
      });
      nodeIds.add(person.id);
    }
  }

  for (const project of projects) {
    if (!nodeIds.has(project.id)) {
      nodes.push({
        id: project.id,
        type: 'project',
        label: project.title,
        importance: 0.7,
        confidence: 1,
        domain: 'projects',
        status: 'active',
        metadata: { hasContradictions: false, linkedEntities: 0 },
      });
      nodeIds.add(project.id);
    }
  }

  for (const goal of goals) {
    if (!nodeIds.has(goal.id)) {
      nodes.push({
        id: goal.id,
        type: 'goal',
        label: goal.title,
        importance: 0.8,
        confidence: 1,
        domain: 'goals',
        status: 'active',
        metadata: { hasContradictions: false, linkedEntities: 0 },
      });
      nodeIds.add(goal.id);
    }
  }

  for (const decision of decisions) {
    if (!nodeIds.has(decision.id)) {
      nodes.push({
        id: decision.id,
        type: 'decision',
        label: decision.title,
        importance: 0.75,
        confidence: 1,
        domain: 'decisions',
        status: 'active',
        metadata: { hasContradictions: false, linkedEntities: 0 },
      });
      nodeIds.add(decision.id);
    }
  }

  // Create edges from entity links
  for (const memory of memories) {
    for (const link of memory.entityLinks) {
      if (nodeIds.has(link.entityId)) {
        edges.push({
          id: `${memory.id}-${link.entityId}`,
          source: memory.id,
          target: link.entityId,
          type: 'links_to',
          strength: 0.8,
          label: link.linkType,
        });
      }
    }
  }

  // Detect similarities and contradictions between memories
  if (includeContradictions && nodeIds.size > 0) {
    // Fetch embeddings separately using raw query (pgvector type not exposed in Prisma client)
    type EmbeddingResult = { id: string; content: string; embedding: number[] | null };
    const memoryIdList = Array.from(nodeIds);

    const embeddings = await prisma.$queryRaw<EmbeddingResult[]>`
      SELECT id, content, embedding
      FROM memory_entries
      WHERE id = ANY(${memoryIdList}::text[])
        AND embedding IS NOT NULL
    `;

    const embeddingMap = new Map<string, EmbeddingResult>(
      embeddings.filter((e: EmbeddingResult) => e.embedding).map((e: EmbeddingResult) => [e.id, e])
    );

    const memoryList = Array.from(embeddingMap.values());

    for (let i = 0; i < memoryList.length; i++) {
      for (let j = i + 1; j < memoryList.length; j++) {
        const m1 = memoryList[i] as EmbeddingResult;
        const m2 = memoryList[j] as EmbeddingResult;

        if (!m1.embedding || !m2.embedding) continue;

        const emb1 = m1.embedding;
        const emb2 = m2.embedding;
        const similarity = cosineSimilarity(emb1, emb2);

        if (similarity >= minSimilarity) {
          // Check for contradiction patterns
          const hasContradiction = detectContradictionPattern(m1.content, m2.content);

          if (hasContradiction) {
            edges.push({
              id: `contradiction-${m1.id}-${m2.id}`,
              source: m1.id,
              target: m2.id,
              type: 'contradicts',
              strength: similarity,
              label: 'Contradiction',
            });

            // Mark nodes as having contradictions
            const node1 = nodes.find(n => n.id === m1.id);
            const node2 = nodes.find(n => n.id === m2.id);
            if (node1) node1.metadata.hasContradictions = true;
            if (node2) node2.metadata.hasContradictions = true;
          } else {
            edges.push({
              id: `similar-${m1.id}-${m2.id}`,
              source: m1.id,
              target: m2.id,
              type: 'similar_to',
              strength: similarity,
              label: `${Math.round(similarity * 100)}% similar`,
            });
          }
        }
      }
    }
  }

  // Create domain clusters
  const domainGroups: Record<string, string[]> = {};
  for (const node of nodes) {
    if (!domainGroups[node.domain]) domainGroups[node.domain] = [];
    domainGroups[node.domain].push(node.id);
  }

  const clusters = Object.entries(domainGroups).map(([domain, nodeIds]) => ({
    id: `cluster-${domain}`,
    label: domain.charAt(0).toUpperCase() + domain.slice(1),
    nodes: nodeIds,
  }));

  // Calculate stats
  const isolatedNodes = nodes.filter(n => !edges.some(e => e.source === n.id || e.target === n.id)).length;
  const contradictionCount = edges.filter(e => e.type === 'contradicts').length;

  logger.info('Memory graph built', {
    userId: userId.substring(0, 10),
    nodes: nodes.length,
    edges: edges.length,
    contradictions: contradictionCount,
  });

  return {
    nodes,
    edges,
    clusters,
    stats: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      contradictions: contradictionCount,
      isolatedNodes,
    },
  };
}

/**
 * Calculate cosine similarity between embeddings
 */
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

/**
 * Detect contradiction patterns between two texts
 */
function detectContradictionPattern(text1: string, text2: string): boolean {
  const patterns = [
    { a: /\b(not|no|never)\b/i, b: /\b(is|are|will|always)\b/i },
    { a: /\b(increase|grow|more)\b/i, b: /\b(decrease|shrink|less)\b/i },
    { a: /\b(start|begin)\b/i, b: /\b(stop|end|cancel)\b/i },
    { a: /\b(good|positive|success)\b/i, b: /\b(bad|negative|failure)\b/i },
  ];

  for (const pattern of patterns) {
    if (pattern.a.test(text1) && pattern.b.test(text2)) return true;
    if (pattern.b.test(text1) && pattern.a.test(text2)) return true;
  }

  return false;
}
