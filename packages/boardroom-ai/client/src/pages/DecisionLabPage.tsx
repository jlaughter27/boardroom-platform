import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../lib/api';
import { StatusBadge } from '../components/dashboard/StatusBadge';
import type { UserMode } from '@boardroom/shared';

interface SessionSummary {
  id: string;
  question: string;
  mode: UserMode;
  personaCount: number;
  hasSynthesis: boolean;
  createdAt: string;
}

const MODE_LABELS: Record<UserMode, string> = {
  'decide': 'Decide',
  'stress-test': 'Stress Test',
  'plan': 'Plan',
  'clarify': 'Clarify',
  'review': 'Review',
  'quick-take': 'Quick Take',
};

export default function DecisionLabPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await api.listSessions(20, 0);
        if (!cancelled) {
          setSessions(result.items);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load sessions');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Decision Lab</h1>
          <p className="text-gray-500 text-sm mt-1">Multi-perspective decision analysis</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/decisions/new')}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors"
        >
          New Decision
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="text-center py-12 text-gray-500 text-sm">Loading sessions...</div>
      )}

      {/* Error */}
      {error && (
        <div className="text-center py-12 text-red-400 text-sm">{error}</div>
      )}

      {/* Empty state */}
      {!isLoading && !error && sessions.length === 0 && (
        <div className="text-center py-12">
          <div className="text-gray-500 text-sm mb-4">No decision sessions yet</div>
          <button
            type="button"
            onClick={() => navigate('/decisions/new')}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors border border-gray-700"
          >
            Start your first analysis
          </button>
        </div>
      )}

      {/* Session list */}
      {!isLoading && sessions.length > 0 && (
        <div className="space-y-3">
          {sessions.map(session => (
            <button
              key={session.id}
              type="button"
              onClick={() => navigate(`/decisions/${session.id}`)}
              className="w-full text-left bg-gray-900 border border-gray-800 rounded-lg p-4 hover:bg-gray-800 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white font-medium truncate">
                    {session.question}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-400 border border-gray-700">
                      {MODE_LABELS[session.mode] ?? session.mode}
                    </span>
                    <span className="text-xs text-gray-600">
                      {session.personaCount} persona{session.personaCount !== 1 ? 's' : ''}
                    </span>
                    {session.hasSynthesis && (
                      <StatusBadge status="completed" />
                    )}
                  </div>
                </div>
                <span className="text-xs text-gray-600 flex-shrink-0">
                  {new Date(session.createdAt).toLocaleDateString()}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
