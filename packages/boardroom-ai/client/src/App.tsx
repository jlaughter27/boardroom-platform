import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuthStore } from './stores/auth.store';
import { Layout } from './components/shared/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import DecisionLabPage from './pages/DecisionLabPage';
import DecisionSessionPage from './pages/DecisionSessionPage';
import MemoryExplorerPage from './pages/MemoryExplorerPage';
import PeopleDirectoryPage from './pages/PeopleDirectoryPage';
import SettingsPage from './pages/SettingsPage';
import CustomPersonasPage from './pages/CustomPersonasPage';
import IntegrationsPage from './pages/IntegrationsPage';
import OnboardingPage from './pages/OnboardingPage';
import * as api from './lib/api';

function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <span className="text-gray-400">Loading...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
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
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <span className="text-gray-400">Loading...</span>
      </div>
    );
  }

  if (needsOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}

export default function App() {
  const { checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <BrowserRouter>
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
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
