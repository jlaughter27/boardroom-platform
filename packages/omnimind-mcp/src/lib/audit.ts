import type { OmniMindClient } from './client';
import type { AuditEntry } from '../types';

export async function writeAuditLog(
  client: OmniMindClient,
  entry: AuditEntry
): Promise<void> {
  // Fire-and-forget — audit failure must never block the tool response
  client.logAudit(entry).catch(err => {
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
