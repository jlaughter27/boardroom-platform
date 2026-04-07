import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TrialBanner } from './TrialBanner';

export function Layout() {
  return (
    <div className="flex h-screen bg-gray-950">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-auto">
        <TrialBanner />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
