// UX-1.3 — Reset Password page.
// Reads ?token=... from URL, POSTs {token, password} to /api/auth/reset-password.
// On success, redirects to /login with a success notice.

import { useState, type FormEvent } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { usePageTitle } from '../hooks/usePageTitle';
import { Button, Input, useToastStore } from '../components/ui';
import { Logo } from '../components/shared/Logo';

export default function ResetPasswordPage() {
  usePageTitle('Reset password — BoardRoom AI');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? 'Reset failed. Try requesting a new link.');
        return;
      }
      addToast('Password reset — please sign in with your new password.', 'success');
      navigate('/login', { replace: true });
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-[400px] text-center">
          <h2 className="text-xl font-bold mb-2">This reset link is invalid.</h2>
          <p className="text-muted-foreground text-sm mb-6">It may have been mistyped or already used.</p>
          <Link to="/forgot-password" className="text-primary hover:text-primary/80 font-medium">
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-[400px]"
      >
        <div className="flex items-center gap-3 mb-8">
          <Logo variant="icon" size={32} className="text-primary" />
          <h1 className="font-display text-lg font-bold tracking-tight">
            <span className="text-primary">Board</span><span className="text-foreground">Room AI</span>
          </h1>
        </div>

        <h2 className="text-2xl font-bold text-foreground mb-2">Choose a new password</h2>
        <p className="text-muted-foreground text-sm mb-6">
          You&rsquo;ll be signed out of all other sessions after resetting.
        </p>

        <form onSubmit={onSubmit} className="space-y-5">
          <Input
            label="New password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoFocus
            placeholder="••••••••••"
          />
          <Input
            label="Confirm new password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={8}
            placeholder="••••••••••"
          />
          {error && (
            <p className="text-sm text-red-500" role="alert">{error}</p>
          )}
          <Button type="submit" variant="primary" size="lg" disabled={busy} className="w-full">
            {busy ? 'Resetting…' : 'Reset password'}
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
