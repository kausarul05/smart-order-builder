import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import AppRoot from './AppRoot';
import { startMockServer } from './server/browser';
import './index.css';

/**
 * MSW is the backend, so it must be listening before the first request
 * leaves the app. Nothing renders until the worker is ready.
 */
async function boot(): Promise<void> {
  await startMockServer();

  const container = document.getElementById('root');
  if (container === null) throw new Error('#root is missing from index.html');

  createRoot(container).render(
    <StrictMode>
      <AppRoot />
    </StrictMode>,
  );
}

void boot();
