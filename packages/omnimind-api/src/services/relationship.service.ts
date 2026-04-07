import type { PrismaClient } from '@prisma/client';

interface GraphNode {
  id: string;
  type: 'person' | 'project';
  label: string;
  size: number;
  domain: string;
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  type: string;
}

export async function getRelationshipGraph(userId: string, prisma: PrismaClient) {
  const [people, projects, links] = await Promise.all([
    prisma.person.findMany({ where: { userId, deletedAt: null }, select: { id: true, name: true, importance: true, domains: true } }),
    prisma.project.findMany({ where: { userId, deletedAt: null }, select: { id: true, title: true, domain: true } }),
    prisma.projectPersonLink.findMany({
      where: { project: { userId } },
      select: { projectId: true, personId: true, role: true },
    }),
  ]);

  const nodes: GraphNode[] = [
    ...people.map(p => ({ id: p.id, type: 'person' as const, label: p.name, size: p.importance * 20 + 10, domain: p.domains[0] ?? '' })),
    ...projects.map(p => ({ id: p.id, type: 'project' as const, label: p.title, size: 15, domain: p.domain })),
  ];

  const edges: GraphEdge[] = links.map(l => ({
    source: l.personId,
    target: l.projectId,
    weight: 2,
    type: l.role || 'member',
  }));

  return { nodes, edges };
}
