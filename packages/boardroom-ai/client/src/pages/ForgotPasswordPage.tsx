// UX-1.3 — Forgot Password page.
// Submits {email} to /api/auth/forgot-password and ALWAYS shows the same
// "if it exists, we sent a link" message — never leak email existence.

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { usePageTitle } from '../hooks/usePageTitle';
import { Button, Input } from '../components/ui';
import { Logo } from '../components/shared/Logo';

export default function ForgotPasswordPage() {
  usePageTitle('Forgot password — BoardRoom AI');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
        credentials: 'include',
      });
    } finally {
      setBusy(false);
      setSubmitted(true);
    }
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

        <h2 className="text-2xl font-bold text-foreground mb-2">Reset your password</h2>
        <p className="text-muted-foreground text-sm mb-6">
          Enter the email associated with your BoardRoom account. We&rsquo;ll send a link to reset your password.
        </p>

        {submitted ? (
          <div
            className="rounded-lg border border-border bg-card p-4 text-sm text-foreground"
            role="status"
            aria-live="polite"
          >
            If an account exists for <strong>{email}</strong>, we&rsquo;ve sent a reset link. It expires in 15 minutes.
            <div className="mt-4">
              <Link to="/login" className="text-primary hover:text-primary/80 font-medium">
                Back to sign in
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <Input
              label="Email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@company.com"
              autoFocus
            />
            <Button type="submit" variant="primary" size="lg" disabled={busy} className="w-full">
              {busy ? 'Sending…' : 'Send reset link'}
            </Button>
            <div className="text-center text-sm">
              <Link to="/login" className="text-muted-foreground hover:text-foreground transition-colors">
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
}
