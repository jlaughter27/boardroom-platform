import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Goal, Person, Project } from '@boardroom/shared';
import * as api from '../../lib/api';
import { useEntitiesStore } from '../../stores/entities.store';
import type { DecisionChangesResponse } from '../../types/debate';
import { Card, Badge, Skeleton } from '../ui';

// ---------------------------------------------------------------------------
// Client-side entity matching
// ---------------------------------------------------------------------------

export interface MatchedEntity {
  type: 'goal' | 'project' | 'person';
  id: string;
  title: string;
  /** Number of significant question tokens that overlap the title. */
  overlap: number;
}

const STOP_WORDS = new Set([
  'should', 'would', 'could', 'about', 'their', 'there', 'these', 'those', 'which', 'where', 'while',
  'with', 'that', 'this', 'from', 'into', 'have', 'what', 'when', 'will', 'does', 'than', 'then',
  'them', 'they', 'your', 'ours', 'more', 'less', 'next', 'last', 'week', 'year', 'month', 'today',
  'decision', 'decide', 'project', 'goal', 'person', 'team', 'plan', 'make', 'take', 'keep', 'need',
]);

/** Lower-cased alphanumeric tokens with ≥ 4 chars that are not stop words. */
export function significantTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 4 && !STOP_WORDS.has(raw)) out.add(raw);
  }
  return out;
}

/**
 * Match a free-text question against goal / project / person titles:
 * case-insensitive token overlap of at least one significant word (≥ 4 chars).
 * Returns matches sorted by overlap desc, then title length asc (more specific first).
 */
export function matchQuestionToEntities(
  question: string,
  entities: { goals: Goal[]; projects: Project[]; people: Person[] },
): MatchedEntity[] {
  const qTokens = significantTokens(question);
  if (qTokens.size === 0) return [];
  const out: MatchedEntity[] = [];
  const consider = (type: MatchedEntity['type'], id: string, title: string) => {
    const tTokens = significantTokens(title);
    let overlap = 0;
    for (const t of tTokens) if (qTokens.has(t)) overlap += 1;
    if (overlap >= 1) out.push({ type, id, title, overlap });
  };
  for (const g of entities.goals) consider('goal', g.id, g.title);
  for (const p of entities.projects) consider('project', p.id, p.title);
  for (const p of entities.people) consider('person', p.id, p.name);
  return out.sort((a, b) => b.overlap - a.overlap || a.title.length - b.title.length);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface WhatChangedCardProps {
  question: string;
  /** Current session id — excluded when looking for the previous session. */
  currentSessionId?: string | null;
}

function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'a month ago' : `${months} months ago`;
}

const ENTITY_BADGE: Record<MatchedEntity['type'], string> = {
  goal: 'bg-entity-goal',
  project: 'bg-entity-project',
  person: 'bg-entity-person',
};

/**
 * "What changed since last time" — first card in a session when the question
 * maps to a known entity and a previous session exists. Calls
 * `GET /decisions/changes?entityId=<type:id>&since=<last session date>`.
 */
export function WhatChangedCard({ question, currentSessionId }: WhatChangedCardProps) {
  const { goals, projects, people, fetchGoals, fetchProjects, fetchPeople } = useEntitiesStore();
  const [since, setSince] = useState<string | null | undefined>(undefined); // undefined = loading
  const [data, setData] = useState<DecisionChangesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // Entities for matching (cheap — cached in the store after first load)
  useEffect(() => {
    if (goals.length === 0) void fetchGoals();
    if (projects.length === 0) void fetchProjects();
    if (people.length === 0) void fetchPeople();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const match = useMemo(
    () => matchQuestionToEntities(question, { goals, projects, people })[0] ?? null,
    [question, goals, projects, people],
  );

  // Previous session date (most recent session that is not the current one)
  useEffect(() => {
    if (!match) return;
    let cancelled = false;
    api.listSessions(10, 0)
      .then((res) => {
        if (cancelled) return;
        const prev = res.items.find((s) => s.id !== currentSessionId);
        setSince(prev ? prev.createdAt : null);
      })
      .catch(() => { if (!cancelled) setSince(null); });
    return () => { cancelled = true; };
  }, [match?.id, currentSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!match || !since) { setData(null); return; }
    let cancelled = false;
    setLoading(true); setFailed(false);
    api.getDecisionChanges(`${match.type}:${match.id}`, since)
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [match?.type, match?.id, since]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!match || since === null || failed) return null;
  if (since === undefined || loading) {
    return (
      <Card className="p-4" aria-busy>
        <Skeleton className="h-4 w-56 mb-2" />
        <Skeleton className="h-3 w-full" />
      </Card>
    );
  }
  if (!data) return null;

  const counts = {
    memories: data.memories.length,
    decisions: data.decisions.length,
    commitments: data.commitments.length,
  };
  const nothing = counts.memories + counts.decisions + counts.commitments === 0;

  return (
    <Card className="border-l-4 p-4" style={{ borderLeftColor: `var(--color-entity-${match.type})` }} data-testid="what-changed-card">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className={`inline-block w-2 h-2 rounded-full ${ENTITY_BADGE[match.type]}`} aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">
          What changed around <span className="text-primary">{match.title}</span>
        </h3>
        <span className="text-xs text-muted-foreground">since your last session {timeAgo(data.since)}</span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        <Badge variant={counts.memories ? 'accent' : 'default'}>{counts.memories} memor{counts.memories === 1 ? 'y' : 'ies'}</Badge>
        <Badge variant={counts.decisions ? 'accent' : 'default'}>{counts.decisions} decision{counts.decisions === 1 ? '' : 's'}</Badge>
        <Badge variant={counts.commitments ? 'accent' : 'default'}>{counts.commitments} commitment{counts.commitments === 1 ? '' : 's'}</Badge>
      </div>

      {nothing ? (
        <p className="text-sm text-muted-foreground">Nothing new on this since then — you are picking up where you left off.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          {counts.memories > 0 && (
            <div>
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Memories</div>
              <ul className="space-y-1">
                {data.memories.slice(0, 3).map((m) => (
                  <li key={m.id} className="truncate">
                    <Link to={`/memory?id=${encodeURIComponent(m.id)}`} className="text-foreground hover:text-primary">
                      {m.title}
                    </Link>
                    {m.invalidAt && <span className="ml-1 text-[11px] text-muted-foreground">(invalidated)</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {counts.decisions > 0 && (
            <div>
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Decisions</div>
              <ul className="space-y-1">
                {data.decisions.slice(0, 3).map((d) => (
                  <li key={d.id} className="truncate">
                    <Link to={d.sessionId ? `/decisions/${d.sessionId}` : '/decisions'} className="text-foreground hover:text-primary">
                      {d.title}
                    </Link>
                    {d.chosenPath && <span className="ml-1 text-[11px] text-muted-foreground">— {d.chosenPath}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {counts.commitments > 0 && (
            <div>
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Commitments</div>
              <ul className="space-y-1">
                {data.commitments.slice(0, 3).map((c) => (
                  <li key={c.id} className="truncate text-foreground">
                    {c.description}
                    {c.deadline && (
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        due {new Date(c.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {data.capsule?.recentChanges?.length ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Capsule: {data.capsule.recentChanges.slice(0, 2).join(' · ')}
        </p>
      ) : null}
    </Card>
  );
}
