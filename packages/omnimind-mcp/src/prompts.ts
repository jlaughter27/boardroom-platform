import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentContext } from './types';

/**
 * Phase 6 — MCP prompts that encode the CLAUDE.md "Dogfooding Rules" and the
 * MEMORY-PROTOCOL session protocol for every client (Claude Desktop, Claude
 * Code, Cursor, ChatGPT). Prompts are pure text: no I/O, no scope checks.
 */
export const PROMPT_NAMES = ['session_start', 'decision_review', 'session_end'] as const;

export function sessionStartText(ctx: AgentContext, domain?: string): string {
  const dom = domain?.trim() || '<the domain you are about to work in>';
  return [
    `You are starting a work session as agent "${ctx.agentName}" in tenant "${ctx.tenantId}". Establish the state of the world before doing anything else.`,
    '',
    '1. Call `status_get` — recent decisions, active tasks, blockers, pending commitments and `commitmentsDueSoon` (due within 3 days / overdue).',
    `2. Call \`memory_search\` with a focused query for the domain you are working in (domain: "${dom}"). Use 2–5 concrete nouns, not "everything"; page with \`cursor\` only if the first page is clearly incomplete.`,
    '3. Read the blockers and overdue commitments that touch your work before you plan.',
    '4. Search before you write: if a fact already exists, `memory_supersede` it instead of creating a duplicate.',
    '',
    'During the session: log resolved decisions with `decision_log`, track work with `task_upsert` / `task_complete` / `task_block`, log promises to people with `commitment_log`. Pass an `idempotencyKey` on writes you may retry.',
  ].join('\n');
}

export function decisionReviewText(decisionTitle: string): string {
  const title = decisionTitle.trim();
  return [
    `Review the decision "${title}" against what the memory layer knows.`,
    '',
    `1. \`memory_search\` for "${title}" (and its key nouns) with \`includeArchived: true\` so superseded facts and past failures surface too.`,
    '2. List the assumptions the decision rests on. For each: is it still true? Which memory supports or contradicts it?',
    '3. Check `status_get` for blockers or overdue commitments that this decision depends on.',
    '4. State: keep / revise / reverse, with the rationale and the memory ids you relied on.',
    `5. If the outcome changes anything durable, record it: \`decision_log\` (title: "Review: ${title}") and \`memory_supersede\` for any fact that is no longer true. Do not log a decision that is still only being considered.`,
  ].join('\n');
}

export function sessionEndText(ctx: AgentContext): string {
  return [
    `Close out the session as agent "${ctx.agentName}" so the next session (any agent) can pick up where you left off.`,
    '',
    '1. `memory_write` ONE context memory (type context, tags ["session-summary"]) that states, in full sentences with named subjects: what was done, what was decided, what is blocked and what the next steps are. Conclusions, not the journey.',
    '2. `decision_log` every decision that was actually made (question → chosen path → rationale).',
    '3. Update task state: `task_complete` for finished work, `task_block` with the reason for anything stuck, `task_upsert` for new work discovered.',
    '4. `commitment_log` any promise made to a person or team, with `toWhom` and `dueDate`.',
    '',
    'An agent that reads but never writes is a consumer; one that writes without reading creates pollution. Do both, every session.',
  ].join('\n');
}

function userMessage(text: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

// The SDK's `registerPrompt` generic recurses through the Zod v3 shape types
// deeply enough to hit TS2589, so arg shapes / callbacks are cast once here
// (same pattern as the tool loop in server.ts). Runtime validation is unaffected.
/* eslint-disable @typescript-eslint/no-explicit-any */
export function registerPrompts(server: McpServer, ctx: AgentContext): void {
  server.registerPrompt(
    'session_start',
    {
      title: 'Session start',
      description: 'Dogfooding rule: run status_get, then memory_search for the domain you are working in, before any sustained work.',
      argsSchema: { domain: z.string().optional().describe('Domain / topic the session is about (used to shape the memory_search query)') } as any,
    },
    ((args: { domain?: string }) => userMessage(sessionStartText(ctx, args?.domain))) as any
  );

  server.registerPrompt(
    'decision_review',
    {
      title: 'Decision review',
      description: 'Re-examine a logged decision against current memory: assumptions, contradictions, blockers; record the verdict.',
      argsSchema: { decisionTitle: z.string().min(1).describe('Title of the decision to review') } as any,
    },
    ((args: { decisionTitle: string }) => userMessage(decisionReviewText(args.decisionTitle))) as any
  );

  server.registerPrompt(
    'session_end',
    {
      title: 'Session end',
      description: 'Dogfooding rule: write a memory_write context summary (what was done + what is next), then log decisions, task states and commitments.',
    },
    (() => userMessage(sessionEndText(ctx))) as any
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
