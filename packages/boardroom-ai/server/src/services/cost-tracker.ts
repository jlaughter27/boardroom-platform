import { MODEL_COSTS } from '@boardroom/shared';
import type { ModelTier } from '@boardroom/shared';

interface CallRecord {
  personaId: string;
  model: ModelTier;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  timestamp: number;
}

interface SessionCost {
  calls: CallRecord[];
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCost: number;
}

const sessionCosts = new Map<string, SessionCost>();
const dailyCosts = new Map<string, { date: string; totalCost: number; sessions: number }>();

/**
 * Track an LLM call's cost.
 */
export function trackCall(
  sessionId: string,
  personaId: string,
  model: ModelTier,
  inputTokens: number,
  outputTokens: number
): void {
  const costs = MODEL_COSTS[model];
  const cost = (inputTokens / 1_000_000) * costs.inputPerMTok + (outputTokens / 1_000_000) * costs.outputPerMTok;

  const record: CallRecord = { personaId, model, inputTokens, outputTokens, cost, timestamp: Date.now() };

  let session = sessionCosts.get(sessionId);
  if (!session) {
    session = { calls: [], totalInputTokens: 0, totalOutputTokens: 0, estimatedCost: 0 };
    sessionCosts.set(sessionId, session);
  }

  session.calls.push(record);
  session.totalInputTokens += inputTokens;
  session.totalOutputTokens += outputTokens;
  session.estimatedCost += cost;
}

/**
 * Get cost summary for a session.
 */
export function getSessionCost(sessionId: string): SessionCost | null {
  return sessionCosts.get(sessionId) ?? null;
}

/**
 * Get daily cost for a user (aggregated across sessions).
 */
export function getDailyCost(userId: string): { sessions: number; totalCost: number } {
  const today = new Date().toISOString().split('T')[0];
  const key = `${userId}:${today}`;
  return dailyCosts.get(key) ?? { sessions: 0, totalCost: 0 };
}

/**
 * Increment daily cost tracking.
 */
export function trackSession(userId: string, sessionCost: number): void {
  const today = new Date().toISOString().split('T')[0];
  const key = `${userId}:${today}`;
  const existing = dailyCosts.get(key) ?? { date: today, totalCost: 0, sessions: 0 };
  existing.totalCost += sessionCost;
  existing.sessions++;
  dailyCosts.set(key, existing);
}
