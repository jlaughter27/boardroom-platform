// Knowledge graph — wire types for GET /graph (OmniMind) and GET /api/graph (BoardRoom)
//
// This is a read-only projection over the entity graph (Goals → Projects →
// Tasks, People, Decisions, Commitments) plus the top-N memories and the
// link tables that connect them. Node ids are namespaced as `<type>:<refId>`
// so ids from different tables can never collide inside one graph.
//
// Timestamps are ISO-8601 strings: this shape only ever crosses the wire
// (the same convention as MemoryApiRecord).

export type KnowledgeGraphNodeType =
  | 'goal'
  | 'project'
  | 'task'
  | 'person'
  | 'decision'
  | 'commitment'
  | 'memory';

export type KnowledgeGraphEdgeType =
  | 'goal_hierarchy'     // Goal.parentGoalId
  | 'goal_project'       // GoalProjectLink
  | 'project_task'       // ProjectTaskLink
  | 'project_person'     // ProjectPersonLink (label = role)
  | 'decision_project'   // DecisionProjectLink
  | 'task_dependency'    // TaskDependency (source depends on target)
  | 'commitment_person'  // Commitment.stakeholderId
  | 'commitment_project' // Commitment.linkedProjectId
  | 'commitment_entity'  // CommitmentLink (polymorphic)
  | 'memory_entity';     // MemoryEntityLink (label = linkType)

export interface KnowledgeGraphNode {
  /** Namespaced id: `${type}:${refId}` */
  id: string;
  type: KnowledgeGraphNodeType;
  /** Primary-key of the underlying row */
  refId: string;
  label: string;
  /** Normalized domain (business / personal / ministry / ai-systems …) or null for domain-less entities */
  domain: string | null;
  /** Entity status as stored (free string for goal/project/task, enum name for decision/commitment/memory) */
  status: string | null;
  /** 0..1 where the entity carries one (person.importance, memory.importance); null otherwise */
  importance: number | null;
  createdAt: string;
  /** Small, type-specific extras (goal.level, task.priority, memory.memoryClass, decision.sessionId …) */
  meta: Record<string, string | number | boolean | null>;
}

export interface KnowledgeGraphEdge {
  /** Stable id: `${type}:${source}->${target}` */
  id: string;
  source: string;
  target: string;
  type: KnowledgeGraphEdgeType;
  /** Role / linkType where the link table carries one */
  label: string | null;
}

export interface KnowledgeGraphStats {
  nodeCounts: Record<KnowledgeGraphNodeType, number>;
  edgeCount: number;
  isolatedNodes: number;
  /** True when the memory layer was truncated to `memoryLimit` */
  memoryLimitHit: boolean;
}

export interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  stats: KnowledgeGraphStats;
  generatedAt: string;
}

export interface KnowledgeGraphQuery {
  /** Restrict to these node types (default: all) */
  types?: KnowledgeGraphNodeType[];
  /** Keep only nodes in this domain plus their domain-less neighbours */
  domain?: string;
  /** Max memories included, ordered by importance desc (default 150, max 500) */
  memoryLimit?: number;
  /** Include ARCHIVED memories (default false) */
  includeArchived?: boolean;
}
