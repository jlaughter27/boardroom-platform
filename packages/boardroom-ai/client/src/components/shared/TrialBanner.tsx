import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSubscription } from '../../lib/api';
import type { SubscriptionData } from '@boardroom/shared';

/** Deep link into the Subscription section of Settings (see SettingsPage hash handling). */
export const BILLING_SETTINGS_PATH = '/settings#settings-subscription';

export function TrialBanner() {
  const [sub, setSub] = useState<SubscriptionData | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getSubscription();
        // Not configured (dev mode) or no subscription row → nothing to nag about here;
        // the upgrade CTA for the latter lives in SubscriptionSettings.
        if (!cancelled) setSub(data.configured ? data.subscription : null);
      } catch {
        // Subscription service unavailable — hide banner
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Hidden for null (dev mode / no row), ACTIVE, CANCELED (still has access)
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
        <Link to={BILLING_SETTINGS_PATH} className="text-primary hover:text-primary/80 underline font-medium">
          Upgrade to Pro
        </Link>
      </div>
    );
  }

  if (sub.status === 'PAST_DUE') {
    return (
      <div className="bg-danger-muted border border-danger/30 px-4 py-2 text-center text-sm">
        <span className="text-foreground">Payment failed</span>
        {' — '}
        <Link to={BILLING_SETTINGS_PATH} className="text-destructive hover:text-destructive/80 underline font-medium">
          Update billing
        </Link>
      </div>
    );
  }

  return null;
}
