import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../../lib/api';

interface SessionSummary {
  id: string;
  question: string;
  mode: string;
  personaCount: number;
  hasSynthesis: boolean;
  createdAt: string;
}

export function RecentDecisions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .listSessions(5, 0)
      .then((res) => {
        setSessions(res.items);
      })
      .catch(() => {
        /* silently fail */
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg p-4 animate-pulse">
        <div className="h-4 bg-gray-800 rounded w-1/3 mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-gray-800 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="bg-gray-900 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-400 mb-2">Recent Decisions</h3>
        <p className="text-gray-500 text-sm">No decisions yet</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">Recent Decisions</h3>
      <div className="space-y-2">
        {sessions.map((session) => (
          <div
            key={session.id}
            className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2"
          >
            <div className="flex-1 min-w-0 mr-3">
              <p className="text-sm text-white truncate">
                {session.question.length > 80
                  ? session.question.slice(0, 80) + '...'
                  : session.question}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-300">
                  {session.mode}
                </span>
                <span className="text-xs text-gray-500">
                  {new Date(session.createdAt).toLocaleDateString()}
                </span>
                <span className="text-xs text-gray-500">
                  {session.personaCount} persona{session.personaCount !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
            <button
              onClick={() => navigate(`/decisions/${session.id}`)}
              className="text-xs text-blue-400 hover:text-blue-300 whitespace-nowrap"
            >
              View
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
