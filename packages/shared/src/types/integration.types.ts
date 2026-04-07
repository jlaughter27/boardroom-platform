// Integration types — API Hub (Claude)
// Gmail email-to-memory integration types

export type IntegrationType = 'gmail' | 'google_calendar';

export interface Integration {
  id: string;
  userId: string;
  type: IntegrationType;
  status: 'connected' | 'disconnected' | 'error';
  lastSyncAt: Date | null;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailSummary {
  emailId: string;
  subject: string;
  from: string;
  date: Date;
  snippet: string;
}

export interface EmailMemoryProposal {
  title: string;
  content: string;
  domain: string;
  tags: string[];
  memoryClass: string;
  importance: number;
  linkedPeople: string[];
}

export interface EmailExtraction {
  emailId: string;
  subject: string;
  from: string;
  date: Date;
  proposedMemories: EmailMemoryProposal[];
}
