import { useState, useEffect, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { usePageTitle } from '../hooks/usePageTitle';
import { useAuthStore } from '../stores/auth.store';
import { Button, Card, Input, useToastStore } from '../components/ui';
import { slideIn, fadeIn } from '../lib/motion';

const VALUE_PROPS = [
  'Stress-test ideas before committing resources',
  'Detect priority drift before it costs you',
  'Every decision backed by your full context',
] as const;

export default function LoginPage() {
  usePageTitle('Login');
  const { isAuthenticated, isLoading, error, login, register, clearError } =
    useAuthStore();
  const addToast = useToastStore((s) => s.addToast);

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [valuePropIndex, setValuePropIndex] = useState(0);

  // Rotate value props every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setValuePropIndex((i) => (i + 1) % VALUE_PROPS.length);
    }, 5000);
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
    <div className="flex min-h-screen">
      {/* Left brand panel */}
      <div className="hidden lg:flex lg:w-[40%] bg-bg-base gradient-mesh flex-col items-center justify-center relative">
        <div className="mesh-blob" />
        <div className="relative z-10 text-center px-12">
          <h1 className="font-display text-3xl font-bold bg-gradient-to-r from-accent to-accent-secondary bg-clip-text text-transparent mb-3">
            BoardRoom
          </h1>
          <p className="text-text-secondary text-lg mb-16">
            Intelligent decisions. Clear direction.
          </p>

          {/* Rotating value props */}
          <div className="h-12 relative">
            <AnimatePresence mode="wait">
              <motion.p
                key={valuePropIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.4 }}
                className="text-text-secondary text-sm absolute inset-x-0"
              >
                &ldquo;{VALUE_PROPS[valuePropIndex]}&rdquo;
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 bg-bg-surface flex items-center justify-center p-6">
        <motion.div
          {...slideIn}
          initial={{ opacity: 0, x: 20 }}
          className="w-full max-w-sm"
        >
          {/* Mobile-only brand */}
          <div className="lg:hidden text-center mb-8">
            <h1 className="font-display text-3xl font-bold bg-gradient-to-r from-accent to-accent-secondary bg-clip-text text-transparent mb-1">
              BoardRoom
            </h1>
            <p className="text-text-secondary text-sm">
              Intelligent decisions. Clear direction.
            </p>
          </div>

          <Card className="border-0 shadow-none bg-transparent p-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={mode}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="text-2xl font-semibold text-text-primary mb-1">
                  {mode === 'login' ? 'Welcome back' : 'Create account'}
                </h2>
                <p className="text-text-secondary text-sm mb-6">
                  {mode === 'login'
                    ? 'Sign in to continue to your dashboard'
                    : 'Get started with BoardRoom AI'}
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <AnimatePresence mode="wait">
                    {mode === 'register' && (
                      <motion.div
                        key="name-field"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <Input
                          label="Name"
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          required
                          placeholder="Your name"
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <Input
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                  />

                  <Input
                    label="Password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                  />

                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    disabled={isLoading}
                    className="w-full"
                  >
                    {isLoading
                      ? 'Loading...'
                      : mode === 'login'
                        ? 'Sign In'
                        : 'Create Account'}
                  </Button>
                </form>

                <div className="text-center mt-6">
                  <span className="text-sm text-text-secondary">
                    {mode === 'login'
                      ? "Don't have an account?"
                      : 'Already have an account?'}{' '}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleMode}
                    className="text-sm"
                  >
                    {mode === 'login' ? 'Sign up' : 'Sign in'}
                  </Button>
                </div>
              </motion.div>
            </AnimatePresence>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
