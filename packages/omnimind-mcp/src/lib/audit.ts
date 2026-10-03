import { isMinistryDomain } from '@boardroom/shared';
import type { OmniMindClient } from './client';
import type { AuditEntry } from '../types';

export const MINISTRY_REDACTED = '[REDACTED:ministry]';

/**
 * Input keys that are safe to keep verbatim for a ministry-domain call.
 * Everything else that is a string is replaced with MINISTRY_REDACTED.
 */
const MINISTRY_INPUT_SAFE_KEYS = new Set([
  'userId', 'domain', 'tags', 'importance', 'limit', 'status', 'skipExtraction', 'projectRef', 'dueDate', 'domains',
]);

/**
 * Output keys that may appear in an audit row. M-104: read-tool results used
 * to be copied verbatim (full decrypted content) into mcp_audit_logs. Now only
 * ids / titles / counts / domains / tags / status flags survive.
 */
const OUTPUT_SAFE_KEYS = new Set([
  'id', 'title', 'domain', 'tags', 'status', 'count', 'counts', 'found', 'action', 'updated', 'completed',
  'blocked', 'logged', 'created', 'skipped', 'ok', 'error', 'message', 'reason', 'project', 'name',
  'memories', 'tasks', 'commitments', 'decisions', 'blockers', 'snapshot', 'recentDecisions', 'activeTasks',
  'pendingCommitments', 'relatedMemories', 'taskList', 'recentMemories', 'success',
  // Phase 6 — pagination / consolidation / graph / nudges / capsules. Ids,
  // counts, flags and structural keys only; capsule summaries, commitment
  // descriptions and node meta are NOT listed and are therefore dropped.
  'nextCursor', 'dryRun', 'scanned', 'pairs', 'keepId', 'archiveId', 'similarity', 'applied', 'errors',
  'root', 'hops', 'nodes', 'edges', 'source', 'target', 'type', 'refId', 'truncated',
  'entityType', 'entityId', 'capsule', 'version', 'generatedAt', 'staleAfter',
  'commitmentsDueSoon', 'dueSoon', 'overdue', 'deadline',
  // R-M-06 — resource payload wrappers (`omnimind://…/goal/{id}`, `/person/{id}`).
  // Structural only: the nested entity is reduced to id / title / name like any
  // other object; descriptions, notes and capsule prose are still dropped.
  'goal', 'person',
]);

/**
 * F-205 / F-212 — Redact a tool input for the audit log when its domain is
 * ministry. Domain comparison is normalized so `' Ministry '` is caught.
 */
export function redactInputForAudit(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const obj = input as Record<string, unknown>;
  if (!isMinistryDomain(typeof obj.domain === 'string' ? obj.domain : undefined)) return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (MINISTRY_INPUT_SAFE_KEYS.has(k)) {
      out[k] = k === 'domain' ? 'ministry' : v;
    } else if (typeof v === 'string') {
      out[k] = MINISTRY_REDACTED;
    } else if (Array.isArray(v) || (v && typeof v === 'object')) {
      out[k] = MINISTRY_REDACTED;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * M-104 — Reduce a tool result to ids/titles/counts/domains. Any item whose
 * `domain` is ministry collapses to `{ id, domain, title: '[REDACTED:ministry]' }`.
 */
export function sanitizeOutputForAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeOutputForAudit);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (isMinistryDomain(typeof obj.domain === 'string' ? obj.domain : undefined)) {
      return { id: obj.id, domain: 'ministry', title: MINISTRY_REDACTED };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!OUTPUT_SAFE_KEYS.has(k)) continue;
      out[k] = sanitizeOutputForAudit(v);
    }
    return out;
  }
  return value;
}

export async function writeAuditLog(
  client: OmniMindClient,
  entry: AuditEntry
): Promise<void> {
  // Fire-and-forget — audit failure must never block the tool response
  client.logAudit(entry).catch(err => {
    console.error('[audit] Failed to write audit log:', (err as Error).message);
  });
}

/**
 * F-212 — Record a refusal that happens BEFORE the tool body runs (e.g. the
 * ministry gate in memory_write / decision_log). Emits success:false + reason
 * so the busiest refusal path is no longer invisible in mcp_audit_logs.
 */
export function auditRefusal(
  client: OmniMindClient,
  ctx: { agentId: string; tenantId: string },
  toolName: string,
  input: unknown,
  reason: string
): void {
  void writeAuditLog(client, {
    agentId: ctx.agentId,
    tenantId: ctx.tenantId,
    toolName,
    inputJson: redactInputForAudit(input),
    outputJson: { success: false, reason },
    errorMessage: reason,
    durationMs: 0,
  });
}

export function withAudit<T>(
  client: OmniMindClient,
  ctx: { agentId: string; tenantId: string },
  toolName: string,
  input: unknown,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  const inputJson = redactInputForAudit(input);
  return fn().then(
    result => {
      void writeAuditLog(client, {
        agentId: ctx.agentId,
        tenantId: ctx.tenantId,
        toolName,
        inputJson,
        outputJson: sanitizeOutputForAudit(result),
        durationMs: Date.now() - start,
      });
      return result;
    },
    err => {
      void writeAuditLog(client, {
        agentId: ctx.agentId,
        tenantId: ctx.tenantId,
        toolName,
        inputJson,
        errorMessage: (err as Error).message,
        durationMs: Date.now() - start,
      });
      throw err;
    }
  );
}
