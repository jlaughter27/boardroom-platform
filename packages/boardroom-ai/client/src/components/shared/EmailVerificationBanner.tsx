// UX-1.4 — soft email-verification banner.
// Renders when the authed user's email isn't yet verified. Dismissible per
// session (sessionStorage) so it doesn't nag inside the same browsing tab.

import { useState } from 'react';
import { useAuthStore } from '../../stores/auth.store';
import { useToastStore } from '../ui';

const DISMISS_KEY = 'boardroom_dismissed_verify_banner';

export function EmailVerificationBanner() {
  const user = useAuthStore((s) => s.user);
  const addToast = useToastStore((s) => s.addToast);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);

  if (!user || dismissed) return null;
  // user.emailVerified is added by /auth/me in Wave 3 Track E. Default-true
  // for older /me responses so we don't show the banner on stale sessions.
  if ((user as unknown as { emailVerified?: boolean }).emailVerified !== false) return null;

  async function resend() {
    setBusy(true);
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        addToast('Verification email sent. Check your inbox.', 'success');
      } else {
        addToast('Could not send verification email. Try again later.', 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* noop */ }
    setDismissed(true);
  }

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-sm text-amber-700 dark:text-amber-300 flex items-center justify-between gap-3">
      <span>
        Confirm your email to keep your account secure.{' '}
        <button
          type="button"
          onClick={resend}
          disabled={busy}
          className="font-medium underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Resend verification email'}
        </button>
      </span>
      <button
        type="button"
        onClick={dismiss}
        className="text-xs opacity-70 hover:opacity-100"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
