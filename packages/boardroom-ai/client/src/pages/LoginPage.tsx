import { useState, useEffect, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { usePageTitle } from '../hooks/usePageTitle';
import { useAuthStore } from '../stores/auth.store';
import { Button, Input, useToastStore } from '../components/ui';
import { Logo } from '../components/shared/Logo';

/* ─── Rotating social proof ─── */
const TESTIMONIALS = [
  { quote: 'It\'s like having a board of advisors who know everything about my business.', role: 'Founder & CEO' },
  { quote: 'I caught a priority conflict that would have cost us two sprints.', role: 'VP of Product' },
  { quote: 'The contextual memory alone is worth it. Every call, every decision — remembered.', role: 'COO, Series B Startup' },
] as const;

const FEATURES = [
  { icon: '⚡', label: 'Multi-persona AI analysis in seconds' },
  { icon: '🧠', label: 'Persistent memory across every session' },
  { icon: '🎯', label: 'Spot blind spots before they become failures' },
] as const;

export default function LoginPage() {
  usePageTitle('BoardRoom AI');
  const { isAuthenticated, isLoading, error, login, register, clearError } =
    useAuthStore();
  const addToast = useToastStore((s) => s.addToast);

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [testimonialIndex, setTestimonialIndex] = useState(0);

  // Rotate testimonials
  useEffect(() => {
    const interval = setInterval(() => {
      setTestimonialIndex((i) => (i + 1) % TESTIMONIALS.length);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  // Show errors as toasts
  useEffect(() => {
    if (error) {
      addToast(error, 'error');
      clearError();
    }
  }, [error, addToast, clearError]);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'login') {
      await login(email, password);
    } else {
      await register(email, password, name);
    }
  };

  const toggleMode = () => {
    clearError();
    setMode((m) => (m === 'login' ? 'register' : 'login'));
  };

  return (
    <div className="flex min-h-screen bg-background">

      {/* ─── Left brand panel ─── */}
      <div
        className="hidden lg:flex lg:w-[52%] relative overflow-hidden flex-col justify-between p-12"
      >
        {/* Static gradient blobs */}
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute top-[8%] left-[12%] w-[500px] h-[500px] rounded-full opacity-20 blur-[100px]"
            style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary))' }}
          />
          <div
            className="absolute bottom-[5%] right-[8%] w-[450px] h-[450px] rounded-full opacity-15 blur-[100px]"
            style={{ background: 'linear-gradient(135deg, var(--color-primary-warm), var(--color-primary-warm))' }}
          />
          <div
            className="absolute top-[45%] left-[35%] w-[350px] h-[350px] rounded-full opacity-10 blur-[80px]"
            style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-warm))' }}
          />
          {/* Subtle grid overlay */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                                linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
              backgroundSize: '60px 60px',
            }}
          />
        </div>

        {/* Top: Brand */}
        <div className="relative z-10">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.5 }}
          >
            <div className="flex items-center gap-3 mb-2">
              <Logo variant="icon" size={40} className="text-primary drop-shadow-[0_0_16px_rgba(212,163,26,0.4)]" />
              <h1 className="font-display text-2xl font-bold tracking-tight">
                <span className="text-primary">Board</span><span className="text-foreground">Room AI</span>
              </h1>
            </div>
          </motion.div>
        </div>

        {/* Center: Hero copy + features */}
        <div className="relative z-10 max-w-md">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
          >
            <h2 className="text-4xl font-bold text-foreground leading-tight tracking-tight mb-4">
              Your AI-powered
              <br />
              <span className="text-primary">
                executive team.
              </span>
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed mb-10">
              Multi-persona decision intelligence that remembers your context, challenges your thinking, and keeps you aligned.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.6 }}
            className="space-y-4"
          >
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.label}
                initial={{ opacity: 0, x: -15 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.6 + i * 0.1, duration: 0.4 }}
                className="flex items-center gap-3"
              >
                <div className="w-9 h-9 rounded-lg bg-card/80 border border-border flex items-center justify-center text-base shrink-0">
                  {f.icon}
                </div>
                <span className="text-muted-foreground text-sm">{f.label}</span>
              </motion.div>
            ))}
          </motion.div>
        </div>

        {/* Bottom: Rotating testimonial */}
        <div className="relative z-10">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.6 }}
          >
            <div className="border-t border-border/50 pt-6">
              <div className="h-20 relative">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={testimonialIndex}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.5 }}
                    className="absolute inset-x-0"
                  >
                    <p className="text-muted-foreground text-sm italic leading-relaxed mb-2">
                      &ldquo;{TESTIMONIALS[testimonialIndex].quote}&rdquo;
                    </p>
                    <p className="text-muted-foreground text-xs">
                      — {TESTIMONIALS[testimonialIndex].role}
                    </p>
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Testimonial progress dots */}
              <div className="flex gap-1.5 mt-2">
                {TESTIMONIALS.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 rounded-full transition-all duration-500 ${
                      i === testimonialIndex
                        ? 'w-6 bg-primary'
                        : 'w-1.5 bg-border'
                    }`}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* ─── Right form panel ─── */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 relative">
        {/* Subtle radial glow behind form */}
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-[0.04] blur-[80px] pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--color-primary), transparent 70%)' }}
        />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="w-full max-w-[380px] relative z-10"
        >
          {/* Mobile-only brand header */}
          <div className="lg:hidden text-center mb-10">
            <div className="flex items-center justify-center gap-3 mb-3">
              <Logo variant="icon" size={40} className="text-primary" />
              <h1 className="font-display text-2xl font-bold tracking-tight">
                <span className="text-primary">Board</span><span className="text-foreground">Room AI</span>
              </h1>
            </div>
            <p className="text-muted-foreground text-sm">
              AI-powered executive decision intelligence
            </p>
          </div>

          {/* Form header */}
          <AnimatePresence mode="wait">
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
            >
              <h2 className="text-[1.65rem] font-bold text-foreground tracking-tight mb-1.5">
                {mode === 'login' ? 'Welcome back' : 'Create your account'}
              </h2>
              <p className="text-muted-foreground text-sm mb-8">
                {mode === 'login'
                  ? 'Enter your credentials to access your boardroom.'
                  : 'Start making smarter decisions in minutes.'}
              </p>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-5">
                <AnimatePresence mode="wait">
                  {mode === 'register' && (
                    <motion.div
                      key="name-field"
                      initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                      animate={{ opacity: 1, height: 'auto', marginBottom: 4 }}
                      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.25 }}
                    >
                      <Input
                        label="Full name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        placeholder="Josh Laughter"
                        className="h-11"
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                <Input
                  label="Email address"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@company.com"
                  className="h-11"
                />

                <div>
                  <Input
                    label="Password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="••••••••••"
                    minLength={8}
                    className="h-11"
                  />
                  {mode === 'register' && (
                    <p className="text-muted-foreground text-xs mt-1.5">
                      Minimum 8 characters
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={isLoading}
                  className="w-full h-12 text-[0.9375rem] font-semibold shadow-lg transition-shadow"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      {mode === 'login' ? 'Signing in...' : 'Creating account...'}
                    </span>
                  ) : mode === 'login' ? (
                    'Sign in'
                  ) : (
                    'Get started'
                  )}
                </Button>
              </form>

              {/* Divider */}
              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 h-px bg-border" />
                <span className="text-muted-foreground text-xs uppercase tracking-wider">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* Mode toggle */}
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  {mode === 'login'
                    ? "Don't have an account?"
                    : 'Already have an account?'}{' '}
                  <button
                    onClick={toggleMode}
                    className="text-primary hover:text-primary/80 font-medium transition-colors duration-fast"
                  >
                    {mode === 'login' ? 'Sign up free' : 'Sign in'}
                  </button>
                </p>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Footer */}
          <div className="mt-10 text-center">
            <p className="text-muted-foreground text-xs">
              By continuing, you agree to BoardRoom's Terms of Service
              <br />and Privacy Policy.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
