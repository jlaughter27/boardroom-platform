import type { OmniMindClient } from './client';
import type { AuditEntry } from '../types';

/**
 * F-205: ministry-redaction defense-in-depth.
 *
 * Tool-level redactors (e.g. `redactForAudit` in memory.tool.ts) handle the
 * known shapes, but a new tool accepting a `domain` field could accidentally
 * forward ministry cleartext into the audit log. This last-line redactor
 * inspects `inputJson` for a normalized `domain === 'ministry'` and replaces
 * any `content` / `newContent` field with a redaction marker.
 *
 * Domain is expected to be already normalized by the DomainSchema in
 * @lib/schemas — this redactor is a fallback if normalization was skipped.
 */
function redactMinistryFields(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const obj = input as Record<string, unknown>;
  const rawDomain = obj.domain;
  if (typeof rawDomain !== 'string') return input;
  if (rawDomain.trim().toLowerCase() !== 'ministry') return input;
  const redacted: Record<string, unknown> = { ...obj, domain: 'ministry' };
  if ('content' in redacted && redacted.content !== undefined) {
    redacted.content = '[REDACTED:ministry]';
  }
  if ('newContent' in redacted && redacted.newContent !== undefined) {
    redacted.newContent = '[REDACTED:ministry]';
  }
  return redacted;
}

export async function writeAuditLog(
  client: OmniMindClient,
  entry: AuditEntry
): Promise<void> {
  // F-205: redact ministry cleartext before persisting.
  const safeEntry: AuditEntry = {
    ...entry,
    inputJson: redactMinistryFields(entry.inputJson),
  };
  // Fire-and-forget — audit failure must never block the tool response
  client.logAudit(safeEntry).catch(err => {
    console.error('[audit] Failed to write audit log:', (err as Error).message);
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
  return fn().then(
    result => {
      writeAuditLog(client, {
        agentId: ctx.agentId,
        tenantId: ctx.tenantId,
        toolName,
        inputJson: input,
        outputJson: result,
        durationMs: Date.now() - start,
      });
      return result;
    },
    err => {
      writeAuditLog(client, {
        agentId: ctx.agentId,
        tenantId: ctx.tenantId,
        toolName,
        inputJson: input,
        errorMessage: (err as Error).message,
        durationMs: Date.now() - start,
      });
      throw err;
    }
  );
}
