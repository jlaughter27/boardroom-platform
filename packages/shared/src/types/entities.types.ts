// Entity types — TASK-004 (DeepSeek)
// Implement from: docs/schemas/database-schema.md

export interface Person {
  id: string;
  userId: string;
  name: string;
  role: string | null;
  domains: string[];
  importance: number;
  relationshipToUser: string | null;
  lastContactAt: Date | null;
  notes: string | null;
  interactionFrequency: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Goal {
  id: string;
  userId: string;
  title: string;
  level: 0 | 1 | 2 | 3;
  parentGoalId: string | null;
  successMetrics: string[];
  deadline: Date | null;
  status: string;
  domain: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  userId: string;
  title: string;
  // Goals linked via GoalProjectLink join table (many-to-many)
  status: string;
  deadline: Date | null;
  successMetrics: string[];
  domain: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Task {
  id: string;
  userId: string;
  // Projects linked via ProjectTaskLink join table (many-to-many)
  title: string;
  owner: string | null;
  status: string;
  deadline: Date | null;
  priority: number;
  estimatedEffort: number | null;
  actualEffort: number | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
