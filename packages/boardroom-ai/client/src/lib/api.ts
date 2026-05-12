// Typed API client for BoardRoom AI
// All calls go through Vite proxy: /api → localhost:3001

import type {
  Goal,
  Project,
  Task,
  Person,
  Decision,
  Commitment,
  UserProfile,
  Memory,
  PaginatedResponse,
  CalendarEvent,
  CalendarSyncStatus,
  EmailSummary,
  EmailExtraction,
  EmailMemoryProposal,
  CreateMemoryResponse,
  UserMode,
  AuthUser,
  SessionSummary,
  SubscriptionData,
} from '@boardroom/shared';

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      /* empty */
    }
    const msg =
      body && typeof body === 'object' && 'message' in body
        ? (body as { message: string }).message
        : `Request failed: ${res.status}`;
    throw new ApiError(msg, res.status, body);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// SSE streaming helper (POST endpoints returning text/event-stream)
// ---------------------------------------------------------------------------

export async function* streamSSE(
  url: string,
  method: string = 'POST',
  body?: unknown,
  signal?: AbortSignal,
): AsyncGenerator<import('@boardroom/shared').BoardRoomSSEEvent & Record<string, unknown>> {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!response.ok) {
    throw new ApiError(
      `SSE request failed: ${response.status}`,
      response.status,
    );
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          yield JSON.parse(line.slice(6));
        } catch {
          /* skip malformed events */
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

interface LoginResponse {
  userId: string;
  name: string;
}

export function login(email: string, password: string) {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function register(email: string, password: string, name: string) {
  return request<LoginResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
}

export function logout() {
  return request<{ status: string }>('/auth/logout', { method: 'POST' });
}

export function getMe() {
  return request<AuthUser>('/auth/me');
}

// ---------------------------------------------------------------------------
// Decision Sessions
// ---------------------------------------------------------------------------

interface CreateSessionRequest {
  question: string;
  mode: UserMode;
  roomId?: string;
}

interface CreateSessionResponse {
  sessionId: string;
  question: string;
  mode: UserMode;
  personasToFire: string[];
  includesCEO: boolean;
}

interface SessionDetail {
  id: string;
  question: string;
  mode: UserMode;
  personaResponses: Record<string, unknown>;
  ceoSynthesis: unknown | null;
  sufficiencyScore: unknown | null;
  createdAt: string;
}

export function createSession(input: CreateSessionRequest) {
  return request<CreateSessionResponse>('/sessions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getSession(id: string) {
  return request<SessionDetail>(`/sessions/${id}`);
}

export function listSessions(limit = 20, offset = 0) {
  return request<PaginatedResponse<SessionSummary>>(
    `/sessions?limit=${limit}&offset=${offset}`,
  );
}

// ---------------------------------------------------------------------------
// SSE stream endpoints (POST — use streamSSE helper)
// ---------------------------------------------------------------------------

export function createDispatchStream(sessionId: string) {
  return streamSSE(`/api/sessions/${sessionId}/dispatch`);
}

export function createSynthesisStream(sessionId: string) {
  return streamSSE(`/api/sessions/${sessionId}/synthesize`);
}

// ---------------------------------------------------------------------------
// Ambiguity check
// ---------------------------------------------------------------------------

export function checkAmbiguity(sessionId: string) {
  return request<import('@boardroom/shared').SufficiencyScore>(
    `/sessions/${sessionId}/check-ambiguity`,
    { method: 'POST' },
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

interface SessionExport {
  id: string;
  question: string;
  mode: UserMode;
  personaResponses: Record<string, import('@boardroom/shared').PersonaResponse>;
  synthesis: import('@boardroom/shared').SynthesisReport | null;
  createdAt: string;
}

export function exportSession(sessionId: string, format: 'json' | 'pdf' = 'json') {
  return request<SessionExport>(
    `/sessions/${sessionId}/export?format=${format}`,
  );
}

// ---------------------------------------------------------------------------
// Entity reads
// ---------------------------------------------------------------------------

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export async function getGoals(): Promise<Goal[]> {
  const res = await request<PaginatedResponse<Goal>>('/goals');
  return res.items;
}

export async function getProjects(): Promise<Project[]> {
  const res = await request<PaginatedResponse<Project>>('/projects');
  return res.items;
}

export async function getTasks(): Promise<Task[]> {
  const res = await request<PaginatedResponse<Task>>('/tasks');
  return res.items;
}

export async function getPeople(): Promise<Person[]> {
  const res = await request<PaginatedResponse<Person>>('/people');
  return res.items;
}

export async function getDecisions(): Promise<Decision[]> {
  const res = await request<PaginatedResponse<Decision>>('/decisions');
  return res.items;
}

export async function getCommitments(): Promise<Commitment[]> {
  const res = await request<PaginatedResponse<Commitment>>('/commitments');
  return res.items;
}

export function getUserProfile() {
  return request<UserProfile>('/profile');
}

// ---------------------------------------------------------------------------
// Entity input types (omit system-managed fields)
// ---------------------------------------------------------------------------

type SystemFields = 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'version';

export type GoalInput = Omit<Goal, SystemFields | 'parentGoalId'> & { parentGoalId?: string | null };
export type ProjectInput = Omit<Project, SystemFields>;
export type TaskInput = Omit<Task, SystemFields>;
export type PersonInput = Omit<Person, SystemFields | 'interactionFrequency' | 'lastContactAt'> & {
  lastContactAt?: Date | null;
};

// ---------------------------------------------------------------------------
// Entity mutations — Goals
// ---------------------------------------------------------------------------

export function createGoal(input: Partial<GoalInput>) {
  return request<Goal>('/goals', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateGoal(id: string, input: Partial<GoalInput>) {
  return request<Goal>(`/goals/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteGoal(id: string) {
  return request<void>(`/goals/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Entity mutations — Projects
// ---------------------------------------------------------------------------

export function createProject(input: Partial<ProjectInput>) {
  return request<Project>('/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateProject(id: string, input: Partial<ProjectInput>) {
  return request<Project>(`/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteProject(id: string) {
  return request<void>(`/projects/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Entity mutations — Tasks
// ---------------------------------------------------------------------------

export function createTask(input: Partial<TaskInput>) {
  return request<Task>('/tasks', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateTask(id: string, input: Partial<TaskInput>) {
  return request<Task>(`/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteTask(id: string) {
  return request<void>(`/tasks/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Entity mutations — People
// ---------------------------------------------------------------------------

export function createPerson(input: Partial<PersonInput>) {
  return request<Person>('/people', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updatePerson(id: string, input: Partial<PersonInput>) {
  return request<Person>(`/people/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deletePerson(id: string) {
  return request<void>(`/people/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export function searchMemories(query: string, limit = 20) {
  return request<{ items: Memory[]; total: number }>(
    `/memories/search?q=${encodeURIComponent(query)}&limit=${limit}`,
  );
}

export interface ListMemoriesParams {
  q?: string;
  domain?: string;
  tags?: string;
  memoryClass?: string;
  status?: string;
  since?: string;
  sortBy?: string;
  sortOrder?: string;
  limit?: number;
  offset?: number;
}

export interface ListMemoriesResponse {
  items: Memory[];
  total: number;
  offset: number;
  limit: number;
}

export function listMemories(params: ListMemoriesParams = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '' && value !== null) {
      qs.set(key, String(value));
    }
  }
  const queryString = qs.toString();
  return request<ListMemoriesResponse>(
    `/memories${queryString ? `?${queryString}` : ''}`,
  );
}

export function getMemory(id: string) {
  return request<Memory>(`/memories/${id}`);
}

export function updateMemory(id: string, input: Partial<Omit<Memory, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>) {
  return request<Memory>(`/memories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function archiveMemory(id: string) {
  return request<void>(`/memories/${id}/archive`, { method: 'POST' });
}

export function createMemory(input: import('@boardroom/shared').CreateMemoryRequest) {
  return request<CreateMemoryResponse>('/memories', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

export function getRelationshipGraph() {
  return request<{ nodes: Array<{ id: string; type: 'person' | 'project'; label: string; size: number; domain: string }>; edges: Array<{ source: string; target: string; weight: number; type: string }> }>(
    '/relationships/graph',
  );
}

// ---------------------------------------------------------------------------
// Memory Entity Links
// ---------------------------------------------------------------------------

export interface MemoryEntityLink {
  id: string;
  memoryId: string;
  entityType: string;
  entityId: string;
  linkType: string;
}

export function createMemoryLink(memoryId: string, data: { entityType: string; entityId: string; linkType?: string }) {
  return request<MemoryEntityLink>(`/memories/${memoryId}/links`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getMemoryLinks(memoryId: string) {
  return request<MemoryEntityLink[]>(`/memories/${memoryId}/links`);
}

export function deleteMemoryLink(memoryId: string, linkId: string) {
  return request<void>(`/memories/${memoryId}/links/${linkId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Outcome Reviews
// ---------------------------------------------------------------------------

import type { OutcomeReviewNudge } from '@boardroom/shared';

export function getPendingReviews() {
  return request<OutcomeReviewNudge[]>('/outcome-reviews/pending');
}

export function completeReview(
  nudgeId: string,
  data: { outcome: string; outcomeRating: number; wouldDecideSame: boolean },
) {
  return request<OutcomeReviewNudge>(`/outcome-reviews/${nudgeId}/complete`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function skipReview(nudgeId: string) {
  return request<OutcomeReviewNudge>(`/outcome-reviews/${nudgeId}/skip`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Cortex — Patterns & Memos
// ---------------------------------------------------------------------------

import type { WeeklyMemo, ThinkingPattern, ContradictionAlert } from '@boardroom/shared';

export function getPatterns(limit = 20, offset = 0) {
  return request<{ items: ThinkingPattern[]; total: number; offset: number; limit: number }>(
    `/cortex/patterns?limit=${limit}&offset=${offset}`,
  );
}

export function triggerPatternScan() {
  return request<{ patterns: ThinkingPattern[]; newCount: number }>(
    '/cortex/patterns/scan',
    { method: 'POST' },
  );
}

export function getLatestMemo() {
  return request<WeeklyMemo | null>('/cortex/memo/latest');
}

export function getMemoHistory(limit = 20, offset = 0) {
  return request<{ items: WeeklyMemo[]; total: number; offset: number; limit: number }>(
    `/cortex/memo/history?limit=${limit}&offset=${offset}`,
  );
}

export function generateMemo() {
  return request<WeeklyMemo | { message: string; minRequired: number }>(
    '/cortex/memo/generate',
    { method: 'POST' },
  );
}

// ---------------------------------------------------------------------------
// Cortex — Contradictions
// ---------------------------------------------------------------------------

export function getContradictions(status?: string, limit = 20, offset = 0) {
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (status) qs.set('status', status);
  return request<{ items: ContradictionAlert[]; total: number; offset: number; limit: number }>(
    `/cortex/contradictions?${qs.toString()}`,
  );
}

// ---------------------------------------------------------------------------
// Cortex — Simulation
// ---------------------------------------------------------------------------

import type { SimulationResult } from '@boardroom/shared';

export function runSimulation(sessionId: string, chosenPath: string, sessionQuestion: string) {
  return request<SimulationResult>('/cortex/simulate', {
    method: 'POST',
    body: JSON.stringify({ sessionId, chosenPath, sessionQuestion }),
  });
}

export function scanContradictions() {
  return request<{ contradictions: ContradictionAlert[]; newCount: number }>(
    '/cortex/contradictions/scan',
    { method: 'POST' },
  );
}

export function updateContradiction(id: string, status: string, resolution?: string) {
  return request<ContradictionAlert>(`/cortex/contradictions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, resolution }),
  });
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export function getCalendarStatus() {
  return request<CalendarSyncStatus>('/calendar/status');
}

export function getCalendarAuthUrl() {
  return request<{ url: string | null; message?: string }>('/calendar/auth-url');
}

export function getCalendarEvents(start: Date, end: Date) {
  return request<CalendarEvent[]>(
    `/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}`,
  );
}

export function disconnectCalendar() {
  return request<{ status: string }>('/calendar/disconnect', { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export function getIntegrations() {
  return request<Array<{ type: string; status: string; lastSyncAt: string | null; error: string | null }>>('/integrations');
}

export function getGmailAuthUrl() {
  return request<{ url: string | null; message?: string }>('/integrations/gmail/auth-url');
}

export function disconnectGmail() {
  return request<{ status: string }>('/integrations/gmail/disconnect', { method: 'POST' });
}

export function getGmailEmails() {
  return request<EmailSummary[]>('/integrations/gmail/emails');
}

export function extractGmailMemories(emailId: string) {
  return request<EmailExtraction>('/integrations/gmail/extract', {
    method: 'POST',
    body: JSON.stringify({ emailId }),
  });
}

export function confirmGmailExtraction(proposals: EmailMemoryProposal[]) {
  return request<{ created: number; rejected: number }>('/integrations/gmail/confirm', {
    method: 'POST',
    body: JSON.stringify({ proposals }),
  });
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

export function getSubscription() {
  return request<SubscriptionData | null>('/subscription');
}

export function createCheckout() {
  return request<{ checkoutUrl: string | null; message?: string }>('/subscription/checkout', {
    method: 'POST',
  });
}

export function cancelSubscription() {
  return request<{ canceledAt: string; activeUntil: string } | null>('/subscription/cancel', {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Custom Personas
// ---------------------------------------------------------------------------

import type { CustomPersona, CreateCustomPersonaRequest, UpdateCustomPersonaRequest } from '@boardroom/shared';

export function getCustomPersonas() {
  return request<CustomPersona[]>('/custom-personas');
}

export function createCustomPersona(input: CreateCustomPersonaRequest) {
  return request<CustomPersona>('/custom-personas', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCustomPersona(id: string, input: UpdateCustomPersonaRequest) {
  return request<CustomPersona>(`/custom-personas/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteCustomPersona(id: string) {
  return request<void>(`/custom-personas/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// User Profile mutations
// ---------------------------------------------------------------------------

export function updateUserProfile(data: Partial<Omit<UserProfile, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>) {
  return request<UserProfile>('/profile', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

interface ExtractedGoal {
  title: string;
  level: number;
  domain: string;
}

interface ExtractedProject {
  title: string;
  domain: string;
  status: string;
}

export function extractOnboardingGoals(text: string) {
  return request<ExtractedGoal[]>('/onboarding/extract-goals', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export function extractOnboardingProjects(text: string) {
  return request<ExtractedProject[]>('/onboarding/extract-projects', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export function completeOnboarding() {
  return request<{ status: string }>('/onboarding/complete', {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Onboarding Bootstrap — single-shot extraction
// ---------------------------------------------------------------------------

export interface BootstrapExtractionResponse {
  role: string;
  industry: string;
  decisionFrequency: string;
  goals: { title: string; level: number; domain: string }[];
  projects: { title: string; domain: string; status: 'active' | 'planning' | 'paused' }[];
  people: { name: string; role: string; relationship: string }[];
  biggestDecision: string;
  worries: string;
}

export interface BootstrapVoiceResponse {
  extraction: BootstrapExtractionResponse;
  transcript: string;
  provider: 'deepgram' | 'whisper';
  transcriptionMs: number;
}

/**
 * Upload a document (File) and receive a BootstrapExtraction. Falls back to
 * JSON { text } payload if the server can't take multipart for some reason.
 */
export async function bootstrapFromDoc(file: File): Promise<BootstrapExtractionResponse> {
  const form = new FormData();
  form.append('file', file);
  // Don't set Content-Type — browser fills in the multipart boundary.
  const res = await fetch('/api/onboarding-bootstrap/doc', {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { /* empty */ }
    const msg = body && typeof body === 'object' && 'message' in body
      ? (body as { message: string }).message
      : `Bootstrap failed: ${res.status}`;
    throw new ApiError(msg, res.status, body);
  }
  return res.json() as Promise<BootstrapExtractionResponse>;
}

/**
 * Upload an audio blob and receive a BootstrapExtraction plus the transcript
 * that was extracted from.
 */
export async function bootstrapFromVoice(blob: Blob, mimeType: string): Promise<BootstrapVoiceResponse> {
  const form = new FormData();
  const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'ogg';
  form.append('audio', blob, `briefing.${ext}`);
  const res = await fetch('/api/onboarding-bootstrap/voice', {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { /* empty */ }
    const msg = body && typeof body === 'object' && 'message' in body
      ? (body as { message: string }).message
      : `Voice bootstrap failed: ${res.status}`;
    throw new ApiError(msg, res.status, body);
  }
  return res.json() as Promise<BootstrapVoiceResponse>;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export interface AdminStats {
  memories: number;
  agents: number;
  tenants: number;
  auditEntries: number;
  sessionSummaries: number;
  lastActivity: string | null;
}

export interface AdminAgent {
  id: string;
  name: string;
  tenantId: string;
  scopes: string[];
  sourceWeight: number;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface AdminAuditEntry {
  id: string;
  agentId: string;
  tenantId: string;
  toolName: string;
  inputJson: unknown;
  outputJson: unknown;
  errorMessage: string | null;
  durationMs: number;
  createdAt: string;
}

export interface AdminMemory {
  id: string;
  title: string;
  content: string;
  domain: string;
  sourceType: string;
  agentId: string | null;
  tenantId: string | null;
  importance: number;
  tags: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminContradiction {
  id: string;
  memoryAId: string;
  memoryBId: string;
  description: string;
  severity: string;
  detectedAt: string;
  resolvedAt: string | null;
}

export function getAdminStats() {
  return request<AdminStats>('/admin/stats');
}

export function getAdminAgents() {
  return request<{ agents: AdminAgent[] }>('/admin/agents');
}

export function getAdminAudit(params?: { agentId?: string; tenantId?: string; toolName?: string; limit?: number; offset?: number }) {
  const qs = params ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))).toString() : '';
  return request<{ entries: AdminAuditEntry[]; total: number; offset: number; limit: number }>(`/admin/audit${qs}`);
}

export function getAdminMemories(params?: { agentId?: string; tenantId?: string; domain?: string; sourceType?: string; q?: string; limit?: number; offset?: number }) {
  const qs = params ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))).toString() : '';
  return request<{ memories: AdminMemory[]; total: number; offset: number; limit: number }>(`/admin/memories${qs}`);
}

export function getAdminContradictions(params?: { limit?: number; offset?: number }) {
  const qs = params ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))).toString() : '';
  return request<{ alerts: AdminContradiction[]; total: number }>(`/admin/contradictions${qs}`);
}

export function triggerAdminSummarize() {
  return request<{ status: string; message: string }>('/admin/summarize', { method: 'POST' });
}

export interface DuplicatePair {
  a_id: string;
  a_title: string;
  a_created: string;
  b_id: string;
  b_title: string;
  b_created: string;
  cosine: number;
}

export function getAdminDuplicates(threshold = 0.85) {
  return request<{ pairs: DuplicatePair[]; threshold: number }>(`/admin/duplicates?threshold=${threshold}`);
}

export function mergeAdminDuplicates(keepId: string, archiveId: string, userId: string) {
  return request<{ status: string; kept: string; archived: string }>('/admin/duplicates/merge', {
    method: 'POST',
    body: JSON.stringify({ keepId, archiveId, userId }),
  });
}

export function triggerAdminDecay() {
  return request<{ status: string; decayed: number }>('/admin/decay/run', { method: 'POST' });
}
