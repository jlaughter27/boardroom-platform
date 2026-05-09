import type { AgentContext } from '../types';
import { ScopeDeniedError } from '../types';

export function requireScope(ctx: AgentContext, required: string): void {
  if (ctx.scopes.includes('*')) return;
  if (ctx.scopes.includes(required)) return;

  // Check wildcard prefix: e.g. 'memory:*' satisfies 'memory:read'
  const [prefix] = required.split(':');
  if (ctx.scopes.includes(`${prefix}:*`)) return;

  throw new ScopeDeniedError(required, ctx.agentName);
}
