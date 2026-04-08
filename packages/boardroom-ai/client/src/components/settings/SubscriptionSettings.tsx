import { useEffect, useState } from 'react';
import { getSubscription, createCheckout, cancelSubscription } from '../../lib/api';
import type { SubscriptionData } from '@boardroom/shared';

export function SubscriptionSettings() {
  const [sub, setSub] = useState<SubscriptionData | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const data = await getSubscription();
        setSub(data);
      } catch {
        // Subscription service unavailable — treat as dev mode
        setSub(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleUpgrade() {
    try {
      const result = await createCheckout();
      if (result?.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      }
    } catch {
      // Could not create checkout
    }
  }

  async function handleCancel() {
    if (!confirm('Are you sure you want to cancel your subscription? You will retain access until the end of your current billing period.')) return;
    setCanceling(true);
    try {
      await cancelSubscription();
      // Reload subscription state
      const data = await getSubscription();
      setSub(data);
    } catch {
      // Failed to cancel
    } finally {
      setCanceling(false);
    }
  }

  if (loading) {
    return (
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Subscription</h2>
        <div className="text-sm text-gray-500">Loading...</div>
      </section>
    );
  }

  // Dev mode — no Stripe configured
  if (sub === null) {
    return (
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Subscription</h2>
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
          <span className="text-sm text-green-400 font-medium">All features unlocked</span>
        </div>
        <p className="text-xs text-gray-500 mt-2">Development mode — no payment required.</p>
      </section>
    );
  }

  // Trialing
  if (sub?.status === 'TRIALING') {
    const trialEnd = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null;
    const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 0;

    return (
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Subscription</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-sm text-blue-400 font-medium">Free Trial</span>
          </div>
          <p className="text-sm text-gray-300">
            {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining in your free trial.
          </p>
          <button
            onClick={handleUpgrade}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
          >
            Upgrade to Pro — $29/month
          </button>
        </div>
      </section>
    );
  }

  // Active
  if (sub?.status === 'ACTIVE') {
    const nextBilling = new Date(sub.currentPeriodEnd);

    return (
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Subscription</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm text-green-400 font-medium">Pro Plan — $29/month</span>
          </div>
          <p className="text-sm text-gray-400">
            Next billing date: {nextBilling.toLocaleDateString()}
          </p>
          <button
            onClick={handleCancel}
            disabled={canceling}
            className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-600/40 text-red-400 text-sm rounded-lg transition-colors disabled:opacity-50"
          >
            {canceling ? 'Canceling...' : 'Cancel Subscription'}
          </button>
        </div>
      </section>
    );
  }

  // Past Due
  if (sub?.status === 'PAST_DUE') {
    return (
      <section className="bg-gray-900 rounded-lg border border-red-800/50 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Subscription</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
            <span className="text-sm text-red-400 font-medium">Payment Failed</span>
          </div>
          <p className="text-sm text-gray-400">
            Your last payment failed. Please update your billing information to continue using BoardRoom.
          </p>
          <button
            onClick={handleUpgrade}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg transition-colors"
          >
            Update Billing
          </button>
        </div>
      </section>
    );
  }

  // Canceled or Expired
  const accessUntil = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  const stillHasAccess = accessUntil && accessUntil.getTime() > Date.now();

  return (
    <section className="bg-gray-900 rounded-lg border border-gray-800 p-6">
      <h2 className="text-lg font-semibold text-white mb-4">Subscription</h2>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-gray-500" />
          <span className="text-sm text-gray-400 font-medium">
            {sub?.status === 'CANCELED' ? 'Canceled' : 'Expired'}
          </span>
        </div>
        {stillHasAccess && (
          <p className="text-sm text-gray-400">
            Access until {accessUntil.toLocaleDateString()}
          </p>
        )}
        <button
          onClick={handleUpgrade}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
        >
          Resubscribe — $29/month
        </button>
      </div>
    </section>
  );
}
