import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './stores/auth.store';
import { Layout } from './components/shared/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import DecisionLabPage from './pages/DecisionLabPage';
import DecisionSessionPage from './pages/DecisionSessionPage';
import MemoryExplorerPage from './pages/MemoryExplorerPage';
import PeopleDirectoryPage from './pages/PeopleDirectoryPage';
import SettingsPage from './pages/SettingsPage';
import OnboardingPage from './pages/OnboardingPage';

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
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/decisions" element={<DecisionLabPage />} />
            <Route path="/decisions/:id" element={<DecisionSessionPage />} />
            <Route path="/memory" element={<MemoryExplorerPage />} />
            <Route path="/people" element={<PeopleDirectoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
