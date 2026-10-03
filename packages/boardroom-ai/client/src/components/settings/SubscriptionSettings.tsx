import { useEffect, useState } from 'react';
import { getSubscription, createCheckout, cancelSubscription } from '../../lib/api';
import type { SubscriptionData } from '@boardroom/shared';

export function SubscriptionSettings() {
  const [sub, setSub] = useState<SubscriptionData | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const data = await getSubscription();
        setConfigured(data.configured);
        setSub(data.subscription);
      } catch (err) {
        // Do NOT masquerade as dev mode — surface the failure (C-104).
        setLoadError(err instanceof Error ? err.message : 'Could not load subscription status');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleUpgrade() {
    setActionError(null);
    try {
      const result = await createCheckout();
      if (result?.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      } else {
        setActionError(result?.message ?? 'Checkout is not available right now.');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not start checkout');
    }
  }

  async function handleCancel() {
    if (!confirm('Are you sure you want to cancel your subscription? You will retain access until the end of your current billing period.')) return;
    setCanceling(true);
    setActionError(null);
    try {
      await cancelSubscription();
      // Reload subscription state
      const data = await getSubscription();
      setConfigured(data.configured);
      setSub(data.subscription);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not cancel subscription');
    } finally {
      setCanceling(false);
    }
  }

  if (loading) {
    return (
      <section className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Subscription</h2>
        <div className="text-sm text-muted-foreground">Loading...</div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="bg-card rounded-lg border border-red-800/50 p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Subscription</h2>
        <p className="text-sm text-destructive">Could not load subscription status: {loadError}</p>
      </section>
    );
  }

  const actionErrorEl = actionError ? (
    <p className="text-xs text-destructive">{actionError}</p>
  ) : null;

  // Billing not configured — Stripe keys absent (local/dev deployments)
  if (!configured) {
    return (
      <section className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Subscription</h2>
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
          <span className="text-sm text-success font-medium">All features unlocked</span>
        </div>
        <p className="text-xs text-muted-foreground mt-2">Billing not configured (dev mode).</p>
      </section>
    );
  }

  // Billing configured but this user has no subscription yet → upgrade CTA
  if (sub === null) {
    return (
      <section className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Subscription</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-text-tertiary" />
            <span className="text-sm text-muted-foreground font-medium">No active plan</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Upgrade to Pro to run decision sessions, synthesis, and simulations.
          </p>
          <button
            onClick={handleUpgrade}
            className="px-4 py-2 bg-primary hover:bg-primary/90 text-foreground text-sm rounded-lg transition-colors"
          >
            Upgrade to Pro — $29/month
          </button>
          {actionErrorEl}
        </div>
      </section>
    );
  }

  // Trialing
  if (sub?.status === 'TRIALING') {
    const trialEnd = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null;
    const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 0;

    return (
      <section className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Subscription</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-primary" />
            <span className="text-sm text-info font-medium">Free Trial</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining in your free trial.
          </p>
          <button
            onClick={handleUpgrade}
            className="px-4 py-2 bg-primary hover:bg-primary/90 text-foreground text-sm rounded-lg transition-colors"
          >
            Upgrade to Pro — $29/month
          </button>
          {actionErrorEl}
        </div>
      </section>
    );
  }

  // Active (possibly with a pending cancellation — the row stays ACTIVE until the period ends)
  if (sub?.status === 'ACTIVE') {
    const nextBilling = new Date(sub.currentPeriodEnd);
    const cancelsAtPeriodEnd = sub.cancelAtPeriodEnd === true;

    return (
      <section className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Subscription</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm text-success font-medium">Pro Plan — $29/month</span>
          </div>
          {cancelsAtPeriodEnd ? (
            <p className="text-sm text-warning" data-testid="subscription-cancels-on">
              Cancels on {nextBilling.toLocaleDateString()} — you keep access until then.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Next billing date: {nextBilling.toLocaleDateString()}
            </p>
          )}
          <button
            onClick={handleCancel}
            disabled={canceling || cancelsAtPeriodEnd}
            title={cancelsAtPeriodEnd ? 'Cancellation already scheduled' : undefined}
            className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-600/40 text-destructive text-sm rounded-lg transition-colors disabled:opacity-50"
          >
            {canceling ? 'Canceling...' : cancelsAtPeriodEnd ? 'Cancellation scheduled' : 'Cancel Subscription'}
          </button>
          {actionErrorEl}
        </div>
      </section>
    );
  }

  // Past Due
  if (sub?.status === 'PAST_DUE') {
    return (
      <section className="bg-card rounded-lg border border-red-800/50 p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Subscription</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
            <span className="text-sm text-destructive font-medium">Payment Failed</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Your last payment failed. Please update your billing information to continue using BoardRoom.
          </p>
          <button
            onClick={handleUpgrade}
            className="px-4 py-2 bg-destructive hover:bg-destructive/90 text-foreground text-sm rounded-lg transition-colors"
          >
            Update Billing
          </button>
          {actionErrorEl}
        </div>
      </section>
    );
  }

  // Canceled or Expired
  const accessUntil = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  const stillHasAccess = accessUntil && accessUntil.getTime() > Date.now();

  return (
    <section className="bg-card rounded-lg border border-border p-6">
      <h2 className="text-lg font-semibold text-foreground mb-4">Subscription</h2>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-text-tertiary" />
          <span className="text-sm text-muted-foreground font-medium">
            {sub?.status === 'CANCELED' ? 'Canceled' : 'Expired'}
          </span>
        </div>
        {stillHasAccess && (
          <p className="text-sm text-muted-foreground">
            Access until {accessUntil.toLocaleDateString()}
          </p>
        )}
        <button
          onClick={handleUpgrade}
          className="px-4 py-2 bg-primary hover:bg-primary/90 text-foreground text-sm rounded-lg transition-colors"
        >
          Resubscribe — $29/month
        </button>
        {actionErrorEl}
      </div>
    </section>
  );
}
