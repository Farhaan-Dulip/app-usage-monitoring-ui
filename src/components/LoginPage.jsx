import { useEffect, useState } from 'react';
import allionLogo from '../assets/allion-logo.png';
import AllionMark from './AllionMark';
import NetworkCanvas from './NetworkCanvas';
import './LoginPage.css';

const BACKEND_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const LOGIN_ERRORS = {
  sso_not_configured: 'Microsoft sign-in is not set up yet. Use your access code.',
  sign_in_expired: 'The sign-in took too long. Please try again.',
  sign_in_cancelled: 'Microsoft sign-in was cancelled.',
  sign_in_failed: 'Microsoft sign-in did not complete. Please try again.',
  account_not_allowed: 'That account is not allowed to use AllionOne.',
};

// The agent's license lifecycle, shown as a roadmap: each stage hands over to
// the next, and Optimize feeds reclaimed seats back into Provision.
const STAGES = [
  {
    icon: 'provision',
    title: 'Provision',
    lead: 'Automate requests & setup',
    text: "Ask in chat or email. The agent routes it to the owner and sets it up the moment it's approved.",
  },
  {
    icon: 'manage',
    title: 'Manage',
    lead: 'Complete inventory & vendor integrations',
    text: 'Every app, owner, cost and device in one live view, wired to vendor admin APIs.',
  },
  {
    icon: 'govern',
    title: 'Govern',
    lead: 'Policies, approvals & compliance',
    text: 'Rules settle the routine. Owners approve the rest. Every decision stays on record.',
  },
  {
    icon: 'optimize',
    title: 'Optimize',
    lead: 'Track usage, find savings & reclaim',
    text: 'Spot idle seats, right-size plans and walk into every renewal with the numbers.',
  },
]

function StageIcon({ type }) {
  const paths = {
    provision: <><path d="M12 4v10" /><path d="m7.5 9.5 4.5 4.5 4.5-4.5" /><path d="M5 18.5h14" /></>,
    manage: <><path d="M4 7.5 12 4l8 3.5-8 3.5z" /><path d="M4 12l8 3.5 8-3.5" /><path d="M4 16.5 12 20l8-3.5" /></>,
    govern: <><path d="M12 3.5 19 6v5.5c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></>,
    optimize: <><path d="M4 18 9.5 12.5l3.5 3.5L20 9" /><path d="M15 9h5v5" /></>,
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[type]}
    </svg>
  );
}

function FieldIcon({ type }) {
  const paths = {
    mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 6 8-6" /></>,
    key: <><circle cx="8" cy="15" r="3.5" /><path d="m10.5 12.5 8-8M16 7l2 2M14 9l1.5 1.5" /></>,
    lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
    chevron: <path d="m9.5 6 6 6-6 6" />,
  };
  return (
    <svg aria-hidden="true" className={`login-field-icon login-field-icon-${type}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[type]}
    </svg>
  );
}

function MicrosoftLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 21 21" width="18" height="18">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export default function LoginPage({ session, onSignedIn }) {
  const methods = session?.methods || {};
  const domain = session?.domains?.[0] || 'alliontechnologies.com';
  const [email, setEmail] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [remember, setRemember] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(() => {
    const code = new URLSearchParams(window.location.search).get('login_error');
    return code ? LOGIN_ERRORS[code] || 'Sign-in did not complete. Please try again.' : '';
  });
  // With Microsoft sign-in set up, an email alone continues there.
  const codeOptional = Boolean(methods.microsoft);

  useEffect(() => {
    // Drop ?login_error from the address bar once it has been shown.
    if (window.location.search.includes('login_error')) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  function showMessage(message, isError = false) {
    setError(isError ? message : '');
    setNotice(isError ? '' : message);
  }

  function microsoftUrl(hint = '') {
    const query = new URLSearchParams();
    if (remember) query.set('remember', '1');
    if (hint) query.set('login_hint', hint);
    const text = query.toString();
    return `${BACKEND_BASE_URL}/api/auth/microsoft/start${text ? `?${text}` : ''}`;
  }

  function handleMicrosoft(event) {
    if (methods.microsoft) return;
    event.preventDefault();
    showMessage('Microsoft sign-in is not set up yet. Use your work email and access code.');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!accessCode) {
      if (codeOptional) {
        window.location.assign(microsoftUrl(email.trim()));
        return;
      }
      showMessage('Enter your access code.', true);
      return;
    }
    setSubmitting(true);
    showMessage('');
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, accessCode, remember }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Sign-in failed. Please try again.');
      await onSignedIn();
    } catch (requestError) {
      showMessage(requestError.message, true);
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <div aria-hidden="true" className="login-glow login-glow-navy" />
      <div aria-hidden="true" className="login-glow login-glow-orange" />
      <div aria-hidden="true" className="login-glow login-glow-cyan" />
      <div aria-hidden="true" className="login-glow login-glow-cyan-soft" />
      <div aria-hidden="true" className="login-glow login-glow-cyan-top" />
      <div aria-hidden="true" className="login-grid" />
      <NetworkCanvas className="login-network" />

      <main className="login-layout">
        <section className="login-hero" aria-labelledby="login-headline">
          <div className="login-brand">
            <AllionMark className="login-brand-mark" />
            <span className="login-brand-divider" aria-hidden="true" />
            <span className="login-brand-name">Allion<span>One</span></span>
          </div>
          <p className="login-eyebrow">Enterprise Software Intelligence Platform</p>
          <h1 id="login-headline" className="login-headline">
            Every application.
            <span>One intelligent platform.</span>
          </h1>
          <p className="login-lede">
            Provision, manage, govern and optimize your enterprise software licenses with AI-powered intelligence.
          </p>
          <ol className="login-roadmap" aria-label="License lifecycle">
            {STAGES.map((stage, index) => (
              <li className={`login-stage login-stage-${stage.icon}`} key={stage.title} style={{ '--stage-delay': `${index * 120}ms` }}>
                <span className="login-stage-node"><StageIcon type={stage.icon} /></span>
                <div className="login-stage-body">
                  <div className="login-stage-head">
                    <strong>{stage.title}</strong>
                    <span className="login-stage-lead">{stage.lead}</span>
                  </div>
                  <p>{stage.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="login-card" aria-labelledby="login-title">
          <img className="login-logo" src={allionLogo} alt="Allion" width="88" height="88" />
          <h2 id="login-title">Welcome to AllionOne</h2>
          <p className="login-card-sub">Sign in to your enterprise account</p>

          {error && <p className="login-message login-error" role="alert">{error}</p>}
          {notice && <p className="login-message login-notice" role="status">{notice}</p>}

          <a className="login-provider login-provider-microsoft" href={microsoftUrl()} onClick={handleMicrosoft}>
            <span className="login-provider-logo"><MicrosoftLogo /></span>
            <span className="login-provider-label">Continue with Microsoft</span>
            <FieldIcon type="chevron" />
          </a>
          <button
            className="login-provider"
            type="button"
            onClick={() => showMessage('SAML single sign-on is not set up for AllionOne yet. Use Microsoft or your access code.')}
          >
            <span className="login-provider-logo"><FieldIcon type="lock" /></span>
            <span className="login-provider-label">Sign in with SSO (SAML)</span>
            <FieldIcon type="chevron" />
          </button>

          <div className="login-divider"><span>or</span></div>

          <form className="login-form" onSubmit={handleSubmit} noValidate={codeOptional}>
            <label htmlFor="login-email">Work email</label>
            <div className="login-input">
              <FieldIcon type="mail" />
              <input
                id="login-email"
                type="email"
                autoComplete="username"
                placeholder="name@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <label htmlFor="login-code">
              Access code{codeOptional && <span className="login-optional"> (optional)</span>}
            </label>
            <div className="login-input login-code-field">
              <FieldIcon type="key" />
              <input
                id="login-code"
                type={showCode ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Enter access code"
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
              />
              <button type="button" onClick={() => setShowCode((shown) => !shown)} aria-pressed={showCode}>
                {showCode ? 'Hide' : 'Show'}
              </button>
            </div>
            <button className="login-submit" type="submit" disabled={submitting}>
              {submitting ? <span className="login-spinner" aria-hidden="true" /> : null}
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
            <div className="login-options">
              <label className="login-remember">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                Keep me signed in
              </label>
              <button
                className="login-forgot"
                type="button"
                onClick={() => showMessage('Access codes are issued by IT. Ask your AllionOne administrator for a new one.')}
              >
                Forgot access code?
              </button>
            </div>
          </form>

          <p className="login-footnote">Authorised Allion users only. Sign-ins are recorded.</p>
        </section>
      </main>

      <footer className="login-footer">© {new Date().getFullYear()} Allion Technologies</footer>
    </div>
  );
}
