import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import LoginPage from './components/LoginPage';
import './styles.css';

const BACKEND_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const SIGNED_OUT_EVENT = 'allionone:signed-out';

// An expired session makes API calls answer 401; return to the sign-in page
// instead of leaving every view showing load errors.
const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  const url = String(args[0]?.url || args[0] || '');
  if (response.status === 401 && url.includes('/api/') && !url.includes('/api/auth/')) {
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  }
  return response;
};

function AuthGate() {
  const [state, setState] = useState({ status: 'loading', session: null });

  const loadSession = useCallback(async () => {
    try {
      const response = await nativeFetch(`${BACKEND_BASE_URL}/api/auth/session`);
      const session = await response.json();
      setState({ status: session.authenticated ? 'signed-in' : 'signed-out', session });
    } catch {
      // The API enforces sign-in itself; without a session answer, show the app.
      setState({ status: 'signed-in', session: null });
    }
  }, []);

  useEffect(() => {
    loadSession();
    const onSignedOut = () => loadSession();
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [loadSession]);

  const signOut = useCallback(async () => {
    await nativeFetch(`${BACKEND_BASE_URL}/api/auth/logout`, { method: 'POST' }).catch(() => {});
    await loadSession();
  }, [loadSession]);

  if (state.status === 'loading') return <div className="login-loading" aria-busy="true" />;
  if (state.status === 'signed-out') return <LoginPage session={state.session} onSignedIn={loadSession} />;
  const user = state.session?.required ? state.session.user : null;
  return <App user={user} onSignOut={user ? signOut : null} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthGate />
  </React.StrictMode>
);
