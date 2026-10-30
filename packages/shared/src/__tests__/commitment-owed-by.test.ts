import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import ts from 'typescript';
import {
  CommitmentSchema,
  CommitmentNudgeItemSchema,
  CreateCommitmentRequestSchema,
  UpdateCommitmentRequestSchema,
  CommitmentOwedBySchema,
} from '../validation/commitment.schema';
import { McpStatusGetOutputSchema, McpDelegationItemSchema } from '../validation/mcp.schema';
import { CommitmentOwedBy } from '../types/commitment.types';
import { endOfUtcDay, daysOverdue, DAY_MS } from '../utils/date';
import { daysUntil } from '../utils/temporal';
import { isDelegation } from '../utils/commitment';
import * as barrel from '../index';

/** RD-12 — commitment direction (owedBy), delegation helpers and the status_get delegations block. */

const ROW = {
  id: 'c1',
  userId: 'u1',
  description: 'Send the volunteer rota',
  stakeholderId: 'p1',
  deadline: '2026-11-07T23:59:59.999Z',
  status: 'OPEN',
  sourceSessionId: null,
  linkedProjectId: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  completedAt: null,
};

describe('CreateCommitmentRequestSchema (owedBy + links)', () => {
  it('accepts a delegation body with links', () => {
    const parsed = CreateCommitmentRequestSchema.parse({
      description: 'Send the volunteer rota',
      stakeholderId: 'p1',
      deadline: '2026-11-07T23:59:59.999Z',
      owedBy: 'STAKEHOLDER',
      links: { decisionId: 'd1', taskId: 't1' },
    });
    expect(parsed.owedBy).toBe(CommitmentOwedBy.STAKEHOLDER);
    expect(parsed.links).toEqual({ decisionId: 'd1', taskId: 't1' });
    expect(parsed.deadline?.toISOString()).toBe('2026-11-07T23:59:59.999Z');
  });

  it('rejects an unknown owedBy and an unknown key inside links (strict)', () => {
    expect(CreateCommitmentRequestSchema.safeParse({ description: 'x', owedBy: 'BOSS' }).success).toBe(false);
    expect(CreateCommitmentRequestSchema.safeParse({ description: 'x', links: { decisionId: 'd1', memoryId: 'm1' } }).success).toBe(false);
    expect(CreateCommitmentRequestSchema.safeParse({ description: 'x', links: { taskId: '' } }).success).toBe(false);
  });

  it("still accepts today's minimal body without owedBy or links", () => {
    const parsed = CreateCommitmentRequestSchema.parse({ description: 'Call the landlord' });
    expect(parsed).toEqual({ description: 'Call the landlord' });
    expect('owedBy' in parsed).toBe(false);
  });

  it('UpdateCommitmentRequestSchema cannot flip direction (owedBy is stripped)', () => {
    const parsed = UpdateCommitmentRequestSchema.parse({ owedBy: 'STAKEHOLDER', status: 'DEFERRED' }) as Record<string, unknown>;
    expect(parsed.owedBy).toBeUndefined();
    expect(parsed.status).toBe('DEFERRED');
  });
});

describe('CommitmentSchema / CommitmentNudgeItemSchema', () => {
  it('parses a row with owedBy and one without', () => {
    expect(CommitmentSchema.parse({ ...ROW, owedBy: 'STAKEHOLDER' }).owedBy).toBe('STAKEHOLDER');
    expect(CommitmentSchema.parse(ROW).owedBy).toBeUndefined();
    expect(CommitmentOwedBySchema.safeParse('USER').success).toBe(true);
  });

  it('CommitmentNudgeItemSchema requires stakeholderName (nullable)', () => {
    expect(CommitmentNudgeItemSchema.safeParse({ ...ROW, owedBy: 'USER' }).success).toBe(false);
    expect(CommitmentNudgeItemSchema.safeParse({ ...ROW, stakeholderName: null }).success).toBe(true);
    expect(CommitmentNudgeItemSchema.parse({ ...ROW, stakeholderName: 'Sam Rivera' }).stakeholderName).toBe('Sam Rivera');
  });
});

// ── Interface ↔ schema (type level; this package's tsconfig excludes tests) ──

const VIRTUAL = resolve(__dirname, '__commitment_owed_by_assert__.ts');
const OPTIONS: ts.CompilerOptions = {
  strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true, skipLibCheck: true, types: [],
};

function typeErrors(source: string): string[] {
  const host = ts.createCompilerHost(OPTIONS);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  host.getSourceFile = (file, lang, ...rest) => (file === VIRTUAL ? ts.createSourceFile(file, source, lang) : getSourceFile(file, lang, ...rest));
  host.fileExists = (file) => file === VIRTUAL || fileExists(file);
  host.readFile = (file) => (file === VIRTUAL ? source : readFile(file));
  const program = ts.createProgram([VIRTUAL], OPTIONS, host);
  return ts.getPreEmitDiagnostics(program, program.getSourceFile(VIRTUAL)).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

const assertion = (commitmentTarget: string, nudgeTarget: string) => `
import type { z } from 'zod';
import { CommitmentSchema, CommitmentNudgeItemSchema } from '../validation/commitment.schema';
import type { Commitment, CommitmentNudgeItem } from '../types/commitment.types';
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;
export const row: Same<z.infer<typeof CommitmentSchema>, ${commitmentTarget}> = true;
export const nudge: Same<z.infer<typeof CommitmentNudgeItemSchema>, ${nudgeTarget}> = true;
`;

describe('Commitment / CommitmentNudgeItem ↔ schemas (type level)', () => {
  it('each schema infers its interface', () => {
    expect(typeErrors(assertion('Commitment', 'CommitmentNudgeItem'))).toEqual([]);
  }, 30_000);

  it('a mismatched interface is caught (control)', () => {
    expect(typeErrors(assertion("Omit<Commitment, 'owedBy'>", 'Commitment')).length).toBeGreaterThan(0);
  }, 30_000);
});

describe('McpStatusGetOutputSchema.delegations', () => {
  const base = {
    snapshot: { recentDecisions: [], activeTasks: [], blockers: [], pendingCommitments: [] },
    counts: { decisions: 0, activeTasks: 0, blockers: 0, commitments: 0 },
    commitmentsDueSoon: { dueSoon: [], overdue: [] },
  };

  it('rejects output missing delegations and accepts an empty block', () => {
    expect(McpStatusGetOutputSchema.safeParse(base).success).toBe(false);
    expect(McpStatusGetOutputSchema.safeParse({ ...base, delegations: { overdue: [], dueSoon: [] } }).success).toBe(true);
  });

  it('McpDelegationItemSchema rejects negative daysOverdue', () => {
    const item = { id: 'c1', description: 'x', personId: null, personName: null, deadline: null, daysOverdue: 0 };
    expect(McpDelegationItemSchema.safeParse(item).success).toBe(true);
    expect(McpDelegationItemSchema.safeParse({ ...item, daysOverdue: -1 }).success).toBe(false);
  });
});

describe('date helpers (RD-12)', () => {
  const deadline = new Date('2026-11-07T23:59:59.999Z');

  it('endOfUtcDay maps a calendar date to the last UTC millisecond and throws on junk', () => {
    expect(endOfUtcDay('2026-11-07').toISOString()).toBe('2026-11-07T23:59:59.999Z');
    expect(() => endOfUtcDay('nope')).toThrow();
    expect(() => endOfUtcDay('2026-02-30')).toThrow();
    expect(DAY_MS).toBe(86_400_000);
  });

  it('daysOverdue is 1 the morning after and 0 before the deadline', () => {
    expect(daysOverdue(deadline, new Date('2026-11-08T10:00:00.000Z'))).toBe(1);
    expect(daysOverdue(deadline, new Date('2026-11-07T15:00:00.000Z'))).toBe(0);
    expect(daysOverdue(deadline.toISOString(), Date.parse('2026-11-10T00:00:00.000Z'))).toBe(3);
  });

  it('daysUntil is 0 on the due day and 1 the day before', () => {
    expect(daysUntil(deadline, new Date('2026-11-07T15:00:00.000Z'))).toBe(0);
    expect(daysUntil(deadline, new Date('2026-11-06T15:00:00.000Z'))).toBe(1);
    expect(daysUntil(deadline.toISOString(), Date.parse('2026-11-06T15:00:00.000Z'))).toBe(1);
  });

  it('isDelegation is true only for STAKEHOLDER', () => {
    expect(isDelegation({ owedBy: 'STAKEHOLDER' })).toBe(true);
    expect(isDelegation({})).toBe(false);
    expect(isDelegation({ owedBy: 'USER' })).toBe(false);
    expect(isDelegation({ owedBy: null })).toBe(false);
  });

  it('the helpers are reachable from the package barrel', () => {
    expect(typeof barrel.isDelegation).toBe('function');
    expect(typeof barrel.endOfUtcDay).toBe('function');
    expect(typeof barrel.daysOverdue).toBe('function');
    expect(typeof barrel.daysUntil).toBe('function');
    expect(barrel.CommitmentOwedBy.STAKEHOLDER).toBe('STAKEHOLDER');
  });
});
