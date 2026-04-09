import { useEffect, useState } from 'react';
import { getSubscription } from '../../lib/api';
import type { SubscriptionData } from '@boardroom/shared';

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
      <div className="bg-info-muted border border-info/30 px-4 py-2 text-center text-sm">
        <span className="text-foreground">
          {daysLeft} day{daysLeft !== 1 ? 's' : ''} left in your free trial
        </span>
        {' — '}
        <a href="/settings?payment=upgrade" className="text-primary hover:text-primary/80 underline font-medium">
          Upgrade to Pro
        </a>
      </div>
    );
  }

  if (sub.status === 'PAST_DUE') {
    return (
      <div className="bg-danger-muted border border-danger/30 px-4 py-2 text-center text-sm">
        <span className="text-foreground">Payment failed</span>
        {' — '}
        <a href="/settings" className="text-destructive hover:text-destructive/80 underline font-medium">
          Update billing
        </a>
      </div>
    );
  }

  return null;
}
