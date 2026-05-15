import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { TooltipProvider } from './components/ui/Tooltip';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <TooltipProvider delayDuration={300} skipDelayDuration={150}>
        <App />
      </TooltipProvider>
    </ErrorBoundary>
  </StrictMode>
);
