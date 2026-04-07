import { useEffect, useState } from 'react';
import { getSubscription } from '../../lib/api';

interface SubscriptionData {
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';
  trialEndsAt: string | null;
}

export function TrialBanner() {
  const [sub, setSub] = useState<SubscriptionData | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await getSubscription();
        setSub(data);
      } catch {
        // Subscription service unavailable — hide banner
      }
    }
    load();
  }, []);

  // Hidden for null (dev mode), ACTIVE, CANCELED (still has access)
  if (!sub) return null;
  if (sub.status === 'ACTIVE' || sub.status === 'CANCELED' || sub.status === 'EXPIRED') return null;

  if (sub.status === 'TRIALING') {
    const trialEnd = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null;
    const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 0;

    return (
      <div className="bg-blue-900/50 border-b border-blue-800/50 px-4 py-2 text-center text-sm">
        <span className="text-blue-200">
          {daysLeft} day{daysLeft !== 1 ? 's' : ''} left in your free trial
        </span>
        {' — '}
        <a href="/settings?payment=upgrade" className="text-blue-400 hover:text-blue-300 underline font-medium">
          Upgrade to Pro
        </a>
      </div>
    );
  }

  if (sub.status === 'PAST_DUE') {
    return (
      <div className="bg-red-900/50 border-b border-red-800/50 px-4 py-2 text-center text-sm">
        <span className="text-red-200">Payment failed</span>
        {' — '}
        <a href="/settings" className="text-red-400 hover:text-red-300 underline font-medium">
          Update billing
        </a>
      </div>
    );
  }

  return null;
}
