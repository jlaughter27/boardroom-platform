import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useAuthStore } from './stores/auth.store';
import { Layout } from './components/shared/Layout';
import { LoadingSpinner } from './components/shared/LoadingSpinner';
import { Toaster } from './components/ui/Toast';
import { TooltipProvider } from './components/ui/Tooltip';
import { RouteTransitionArmer } from './hooks/useRouteTransition';

const CommandPalette = lazy(() => import('./components/ui/CommandPalette').then(m => ({ default: m.CommandPalette })));
import * as api from './lib/api';
import { ApiError } from './lib/api';
import { TriangleAlert } from 'lucide-react';
import { Button } from './components/ui/Button';

// Eager — needed immediately
import LoginPage from './pages/LoginPage';
import OnboardingPage from './pages/OnboardingPage';

// Lazy — loaded on demand
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const DecisionLabPage = lazy(() => import('./pages/DecisionLabPage'));
const DecisionSessionPage = lazy(() => import('./pages/DecisionSessionPage'));
const MemoryExplorerPage = lazy(() => import('./pages/MemoryExplorerPage'));
const PeopleDirectoryPage = lazy(() => import('./pages/PeopleDirectoryPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const CustomPersonasPage = lazy(() => import('./pages/CustomPersonasPage'));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const GraphPage = lazy(() => import('./pages/GraphPage'));

function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <span className="text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

/** Admin-only routes: redirect non-admins to the dashboard (C-103). */
function AdminRoute() {
  const user = useAuthStore((s) => s.user);
  if (!user?.isAdmin) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

type GateState =
  | { status: 'checking' }
  | { status: 'ready' }
  | { status: 'onboarding' }
  | { status: 'unavailable'; reason: string };

/**
 * Why the profile could not be read, in words for the retry banner. Only a 404
 * means "no profile yet"; everything else is the service being unreachable.
 */
export function describeProfileFailure(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503) return 'The memory service is unavailable right now (503).';
    if (err.status >= 500) return `The memory service returned an error (${err.status}).`;
    return err.message || `The profile request failed (${err.status}).`;
  }
  return 'The server could not be reached. Check your connection.';
}

/**
 * Sends a user without a finished profile to /onboarding — and ONLY then.
 * A 404 (no profile yet) or `onboardingComplete: false` navigates; a 5xx, a
 * network error or an open OmniMind breaker (surfaced as 503) must not send an
 * onboarded user back through onboarding, so the shell renders as usual with a
 * retry banner instead (M1-D3).
 */
export function OnboardingGate() {
  const [state, setState] = useState<GateState>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getUserProfile()
      .then((profile) => {
        if (cancelled) return;
        setState(!profile || !profile.onboardingComplete ? { status: 'onboarding' } : { status: 'ready' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setState({ status: 'onboarding' });
        else setState({ status: 'unavailable', reason: describeProfileFailure(err) });
      })
      .finally(() => {
        if (!cancelled) setRetrying(false);
      });
    return () => { cancelled = true; };
  }, [attempt]);

  if (state.status === 'checking') {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <span className="text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (state.status === 'onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <>
      <Outlet />
      {state.status === 'unavailable' && (
        <ProfileUnavailableBanner
          reason={state.reason}
          retrying={retrying}
          onRetry={() => { setRetrying(true); setAttempt((n) => n + 1); }}
        />
      )}
    </>
  );
}

function ProfileUnavailableBanner({ reason, retrying, onRetry }: { reason: string; retrying: boolean; onRetry: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-toast flex justify-center">
      <div
        role="alert"
        data-testid="profile-unavailable-banner"
        className="pointer-events-auto flex w-full max-w-lg items-center gap-3 rounded-xl border border-warning/40 bg-card p-3 pl-4 shadow-lg"
      >
        <TriangleAlert size={18} strokeWidth={1.75} className="shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Your profile could not be loaded</p>
          <p className="text-xs text-muted-foreground">{reason} Everything else keeps working; personalization is paused until it loads.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onRetry} loading={retrying}>Retry</Button>
      </div>
    </div>
  );
}

const PageFallback = (
  <div className="flex items-center justify-center min-h-screen bg-background">
    <LoadingSpinner size="lg" />
  </div>
);

export default function App() {
  const { checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <>
    {/* Before the router on purpose: its popstate listener must register first (see hooks/useRouteTransition.ts). */}
    <RouteTransitionArmer />
    <BrowserRouter>
      <TooltipProvider>
      <Toaster />
      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>
      <Suspense fallback={PageFallback}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            {/* Onboarding — no sidebar/layout */}
            <Route path="/onboarding" element={<OnboardingPage />} />
            {/* Main app — with onboarding gate */}
            <Route element={<OnboardingGate />}>
              <Route element={<Layout />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/decisions" element={<DecisionLabPage />} />
                <Route path="/decisions/:id" element={<DecisionSessionPage />} />
                <Route path="/memory" element={<MemoryExplorerPage />} />
                <Route path="/people" element={<PeopleDirectoryPage />} />
                <Route path="/graph" element={<GraphPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/personas" element={<CustomPersonasPage />} />
                <Route path="/integrations" element={<IntegrationsPage />} />
                <Route element={<AdminRoute />}>
                  <Route path="/admin" element={<AdminPage />} />
                </Route>
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      </TooltipProvider>
    </BrowserRouter>
    </>
  );
}
