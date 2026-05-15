import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useAuthStore } from './stores/auth.store';
import { Layout } from './components/shared/Layout';
import { LoadingSpinner } from './components/shared/LoadingSpinner';
import { Toaster } from './components/ui/Toast';

const CommandPalette = lazy(() => import('./components/ui/CommandPalette').then(m => ({ default: m.CommandPalette })));
import * as api from './lib/api';

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

/** Gates /admin behind the user.isAdmin flag sourced from /auth/me. */
function AdminOnlyRoute() {
  const { user, isLoading } = useAuthStore();
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <span className="text-muted-foreground">Loading...</span>
      </div>
    );
  }
  if (!user?.isAdmin) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

/** Redirects to /onboarding if profile.onboardingComplete is false */
function OnboardingGate() {
  const [checked, setChecked] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getUserProfile()
      .then(profile => {
        if (!cancelled) {
          setNeedsOnboarding(!profile.onboardingComplete);
          setChecked(true);
        }
      })
      .catch(() => {
        // If profile fetch fails (e.g. no profile yet), send to onboarding
        if (!cancelled) {
          setNeedsOnboarding(true);
          setChecked(true);
        }
      });
    return () => { cancelled = true; };
  }, []);

  if (!checked) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <span className="text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (needsOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
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
    <BrowserRouter>
      <Toaster />
      <CommandPalette />
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
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/personas" element={<CustomPersonasPage />} />
                <Route path="/integrations" element={<IntegrationsPage />} />
                <Route element={<AdminOnlyRoute />}>
                  <Route path="/admin" element={<AdminPage />} />
                </Route>
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
