import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/global.css';
import './styles/report.css';
import './styles/app.css';
import { App } from './App';
import { api, ApiError } from './lib/api';
import { Router } from './lib/router';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

/**
 * In production this bundle is only ever delivered to a request that
 * already holds a valid session, so this check always passes. It exists
 * for the development server, which serves every file to everyone, and
 * for a session that expires while the tab is open.
 */
api
  .get('/api/session')
  .then(() => {
    createRoot(root).render(
      <StrictMode>
        <Router>
          <App />
        </Router>
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      window.location.replace(import.meta.env.DEV ? '/gate.html' : '/');
      return;
    }
    root.textContent = 'The site could not reach its own server. Please reload.';
  });
