import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import * as api from '../../lib/api';
import type { SessionSummary } from '@boardroom/shared';
import { Card, Badge, Button, Skeleton } from '../ui';
import { staggerContainer, staggerItem } from '../../lib/motion';

const MODE_VARIANT: Record<string, 'accent' | 'warning' | 'info' | 'success' | 'default'> = {
  decide: 'accent',
  'stress-test': 'warning',
  plan: 'info',
  clarify: 'success',
  review: 'default',
  'quick-take': 'default',
};

function timeAgo(dateStr: string | Date): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

export function RecentDecisions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .listSessions(5, 0)
      .then((res) => setSessions(res.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card className="p-4">
        <Skeleton className="h-4 w-1/3 mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-md" />
          ))}
        </div>
      </Card>
    );
  }

  if (sessions.length === 0) {
    return (
      <Card className="p-4">
        <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-2">
          Recent Decisions
        </h3>
        <p className="text-text-tertiary text-sm">No decisions yet</p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-3">
        Recent Decisions
      </h3>
      <motion.div {...staggerContainer} className="space-y-2">
        {sessions.map((session) => (
          <motion.div key={session.id} {...staggerItem}>
            <Card
              hover
              className="px-3 py-2"
              onClick={() => navigate(`/decisions/${session.id}`)}
            >
              <p className="text-sm text-text-primary font-medium truncate">
                {session.question.length > 80
                  ? session.question.slice(0, 80) + '...'
                  : session.question}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={MODE_VARIANT[session.mode] ?? 'default'}>
                  {session.mode}
                </Badge>
                <span className="text-xs text-text-tertiary">
                  {timeAgo(session.createdAt)}
                </span>
                <span className="text-xs text-text-tertiary">
                  {session.personaCount} persona{session.personaCount !== 1 ? 's' : ''}
                </span>
              </div>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </Card>
  );
}
