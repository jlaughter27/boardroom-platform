import { useEffect, useState, useMemo } from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import * as api from '../lib/api';
import type { UserMode, SessionSummary } from '@boardroom/shared';
import { PageWrapper, Card, Button, Badge, Skeleton, EmptyState, Tabs, Avatar } from '../components/ui';
import { ErrorBanner } from '../components/shared/ErrorBanner';
import { staggerContainer, staggerItem } from '../lib/motion';

const MODE_LABELS: Record<UserMode, string> = {
  'decide': 'Decide',
  'stress-test': 'Stress Test',
  'plan': 'Plan',
  'clarify': 'Clarify',
  'review': 'Review',
  'quick-take': 'Quick Take',
};

const MODE_VARIANT: Record<string, 'accent' | 'warning' | 'info' | 'success' | 'default'> = {
  decide: 'accent',
  'stress-test': 'warning',
  plan: 'info',
  clarify: 'success',
  review: 'default',
  'quick-take': 'default',
};

const FILTER_TABS = [
  { value: 'all', label: 'All' },
  { value: 'decide', label: 'Decide' },
  { value: 'stress-test', label: 'Stress Test' },
  { value: 'plan', label: 'Plan' },
  { value: 'clarify', label: 'Clarify' },
  { value: 'review', label: 'Review' },
];

type SortKey = 'newest' | 'oldest';

function timeAgo(dateStr: string | Date): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

function SessionSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-20 rounded-lg" />
      ))}
    </div>
  );
}

export default function DecisionLabPage() {
  usePageTitle('Decision Lab');
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState<SortKey>('newest');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await api.listSessions(50, 0);
        if (!cancelled) setSessions(result.items);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load sessions');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    let result = filter === 'all' ? sessions : sessions.filter((s) => s.mode === filter);
    if (sort === 'oldest') result = [...result].reverse();
    return result;
  }, [sessions, filter, sort]);

  return (
    <PageWrapper>
      <div className="p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">Decision Lab</h1>
            <p className="text-text-secondary text-sm mt-0.5">
              {sessions.length} decision{sessions.length !== 1 ? 's' : ''} analyzed
            </p>
          </div>
          <Button variant="primary" onClick={() => navigate('/decisions/new')}>
            <svg className="w-4 h-4 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            New Decision
          </Button>
        </div>

        {/* Error */}
        {error && (
          <ErrorBanner
            message={error}
            onRetry={() => { setError(null); setIsLoading(true); api.listSessions(50, 0).then((r) => setSessions(r.items)).catch((e) => setError(e.message)).finally(() => setIsLoading(false)); }}
            onDismiss={() => setError(null)}
          />
        )}

        {/* Filter/sort bar */}
        {!isLoading && sessions.length > 0 && (
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1">
              {FILTER_TABS.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setFilter(tab.value)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    filter === tab.value
                      ? 'bg-accent-muted text-accent'
                      : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="bg-bg-base border border-line rounded-md px-2 py-1 text-xs text-text-secondary outline-none focus:border-accent"
            >
              <option value="newest">Most Recent</option>
              <option value="oldest">Oldest</option>
            </select>
          </div>
        )}

        {/* Loading */}
        {isLoading && <SessionSkeleton />}

        {/* Empty state */}
        {!isLoading && !error && sessions.length === 0 && (
          <EmptyState
            variant="no-decisions"
            title="No decisions yet"
            description="Start your first decision analysis to see it here"
            action={{ label: 'Start Your First Decision', onClick: () => navigate('/decisions/new') }}
          />
        )}

        {/* Session list */}
        {!isLoading && filtered.length > 0 && (
          <motion.div {...staggerContainer} className="space-y-3">
            {filtered.map((session) => (
              <motion.div key={session.id} {...staggerItem}>
                <Card
                  hover
                  onClick={() => navigate(`/decisions/${session.id}`)}
                  className="p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-text-primary font-medium line-clamp-2">
                        {session.question}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant={MODE_VARIANT[session.mode] ?? 'default'}>
                          {MODE_LABELS[session.mode] ?? session.mode}
                        </Badge>
                        {/* Persona stack */}
                        <div className="flex -space-x-1">
                          {Array.from({ length: Math.min(3, session.personaCount) }, (_, i) => (
                            <div
                              key={i}
                              className="w-5 h-5 rounded-full bg-bg-elevated border border-line flex items-center justify-center text-[8px] text-text-tertiary"
                            >
                              P
                            </div>
                          ))}
                          {session.personaCount > 3 && (
                            <div className="w-5 h-5 rounded-full bg-bg-elevated border border-line flex items-center justify-center text-[8px] text-text-tertiary">
                              +{session.personaCount - 3}
                            </div>
                          )}
                        </div>
                        {session.hasSynthesis && (
                          <Badge variant="success">Synthesized</Badge>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-text-tertiary flex-shrink-0">
                      {timeAgo(session.createdAt)}
                    </span>
                  </div>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* Filtered empty */}
        {!isLoading && sessions.length > 0 && filtered.length === 0 && (
          <div className="text-center py-12">
            <p className="text-text-tertiary text-sm">No {filter} sessions found</p>
          </div>
        )}
      </div>
    </PageWrapper>
  );
}
