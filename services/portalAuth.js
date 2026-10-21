import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { serviceTokenMatches } from './serviceAuth.js';

// Portal sign-in: Microsoft Entra ID (OpenID Connect authorization code flow)
// and, for the POC, a shared access code limited to company email domains.
// Either method turns sign-in on; with neither configured the portal stays open
// (local development).
export const SESSION_COOKIE = 'allionone_session';
const OAUTH_COOKIE = 'allionone_oauth';
const SESSION_HOURS = 12;
// "Keep me signed in": a persistent cookie instead of one that ends with the browser.
const REMEMBER_DAYS = 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPTS = 10;

export function authConfig(env = process.env) {
  const tenantId = env.PORTAL_SSO_TENANT_ID?.trim();
  const clientId = env.PORTAL_SSO_CLIENT_ID?.trim();
  const clientSecret = env.PORTAL_SSO_CLIENT_SECRET?.trim();
  const accessCode = env.PORTAL_ACCESS_CODE?.trim();
  const publicUrl = (env.PUBLIC_PORTAL_URL || '').trim().replace(/\/+$/, '');
  const domains = String(env.PORTAL_LOGIN_DOMAINS || 'alliontechnologies.com')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  // A dedicated secret, else one derived from the credentials key (stable across
  // restarts), else a per-process key (sessions end when the server restarts).
  const secretSource = env.PORTAL_SESSION_SECRET?.trim() || (env.CREDENTIALS_KEY?.trim() && `session:${env.CREDENTIALS_KEY.trim()}`);
  const sessionKey = secretSource ? createHash('sha256').update(secretSource).digest() : randomBytes(32);
  const microsoft = Boolean(tenantId && clientId && clientSecret && publicUrl);
  return {
    microsoft: microsoft ? { tenantId, clientId, clientSecret, redirectUri: `${publicUrl}/api/auth/microsoft/callback` } : null,
    accessCode: accessCode || null,
    domains,
    sessionKey,
    secureCookies: publicUrl.startsWith('https://'),
    required: Boolean(microsoft || accessCode),
  };
}

const base64url = (value) => Buffer.from(value).toString('base64url');

function sign(payload, key) {
  const body = base64url(JSON.stringify(payload));
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
}

function verify(token, key) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = createHmac('sha256', key).update(body).digest();
  const provided = Buffer.from(signature || '', 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

// maxAgeSeconds null makes a browser-session cookie.
function cookie(name, value, { maxAgeSeconds, secure }) {
  const maxAge = maxAgeSeconds === null ? '' : `Max-Age=${maxAgeSeconds}`;
  return [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', maxAge, secure ? 'Secure' : '']
    .filter(Boolean)
    .join('; ');
}

export function sessionFromRequest(req, config) {
  return verify(readCookie(req, SESSION_COOKIE), config.sessionKey);
}

export function emailAllowed(email, domains) {
  const domain = String(email || '').toLowerCase().split('@')[1];
  return Boolean(domain) && domains.includes(domain);
}

function setSession(res, config, user, { remember = false } = {}) {
  const seconds = remember ? REMEMBER_DAYS * 24 * 60 * 60 : SESSION_HOURS * 60 * 60;
  res.append('Set-Cookie', cookie(SESSION_COOKIE, sign({ ...user, exp: Date.now() + seconds * 1000 }, config.sessionKey), {
    maxAgeSeconds: remember ? seconds : null,
    secure: config.secureCookies,
  }));
  console.info(`Portal sign-in: ${user.email} (${user.method})`);
}

function displayName(email) {
  return String(email).split('@')[0].split(/[._-]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

// The ID token comes straight from Entra's token endpoint over TLS, so its
// claims are trusted without checking the signature (OpenID Connect Core 3.1.3.7).
function idTokenClaims(idToken) {
  try {
    return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function createAuthRouter({ express, config = authConfig(), fetchImpl = fetch }) {
  const router = express.Router();
  const attempts = new Map();

  const clientAddress = (req) => String(req.get('X-Forwarded-For') || req.ip || '').split(',')[0].trim();
  function rateLimited(req) {
    const key = clientAddress(req);
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter((time) => now - time < LOGIN_WINDOW_MS);
    recent.push(now);
    attempts.set(key, recent);
    return recent.length > LOGIN_ATTEMPTS;
  }

  router.get('/session', (req, res) => {
    const session = sessionFromRequest(req, config);
    res.json({
      required: config.required,
      authenticated: !config.required || Boolean(session),
      user: session ? { email: session.email, name: session.name, method: session.method } : null,
      methods: { microsoft: Boolean(config.microsoft), accessCode: Boolean(config.accessCode) },
      domains: config.domains,
    });
  });

  router.post('/login', (req, res) => {
    if (!config.accessCode) return res.status(404).json({ error: 'Access code sign-in is not enabled.' });
    if (rateLimited(req)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!emailAllowed(email, config.domains)) {
      return res.status(401).json({ error: `Use your work email (${config.domains.map((domain) => `@${domain}`).join(', ')}).` });
    }
    if (!serviceTokenMatches(String(req.body?.accessCode || ''), config.accessCode)) {
      return res.status(401).json({ error: 'The email or access code is not correct.' });
    }
    setSession(res, config, { email, name: displayName(email), method: 'access-code' }, { remember: req.body?.remember === true });
    return res.json({ ok: true });
  });

  router.post('/logout', (_req, res) => {
    res.append('Set-Cookie', cookie(SESSION_COOKIE, '', { maxAgeSeconds: 0, secure: config.secureCookies }));
    res.json({ ok: true });
  });

  router.get('/microsoft/start', (req, res) => {
    if (!config.microsoft) return res.redirect('/?login_error=sso_not_configured');
    const remember = req.query.remember === '1';
    // The email typed on the sign-in page, so Microsoft skips the account picker.
    const loginHint = typeof req.query.login_hint === 'string' && /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(req.query.login_hint) ? req.query.login_hint : '';
    const { tenantId, clientId, redirectUri } = config.microsoft;
    const state = randomBytes(16).toString('base64url');
    const nonce = randomBytes(16).toString('base64url');
    res.append('Set-Cookie', cookie(OAUTH_COOKIE, sign({ state, nonce, remember, exp: Date.now() + 10 * 60 * 1000 }, config.sessionKey), {
      maxAgeSeconds: 600,
      secure: config.secureCookies,
    }));
    const query = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: 'openid profile email',
      state,
      nonce,
      ...(loginHint ? { login_hint: loginHint } : { prompt: 'select_account' }),
    });
    return res.redirect(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize?${query}`);
  });

  router.get('/microsoft/callback', async (req, res) => {
    const fail = (reason) => {
      res.append('Set-Cookie', cookie(OAUTH_COOKIE, '', { maxAgeSeconds: 0, secure: config.secureCookies }));
      return res.redirect(`/?login_error=${encodeURIComponent(reason)}`);
    };
    if (!config.microsoft) return fail('sso_not_configured');
    const pending = verify(readCookie(req, OAUTH_COOKIE), config.sessionKey);
    if (!pending || typeof req.query.state !== 'string' || req.query.state !== pending.state) return fail('sign_in_expired');
    if (req.query.error || typeof req.query.code !== 'string') return fail('sign_in_cancelled');
    const { tenantId, clientId, clientSecret, redirectUri } = config.microsoft;
    try {
      const response = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code: req.query.code,
          redirect_uri: redirectUri,
          scope: 'openid profile email',
        }),
      });
      const tokens = await response.json().catch(() => ({}));
      const claims = response.ok ? idTokenClaims(tokens.id_token) : null;
      if (!claims || claims.aud !== clientId || claims.tid !== tenantId || claims.nonce !== pending.nonce || claims.exp * 1000 < Date.now()) {
        return fail('sign_in_failed');
      }
      const email = String(claims.preferred_username || claims.email || claims.upn || '').toLowerCase();
      if (!emailAllowed(email, config.domains)) return fail('account_not_allowed');
      res.append('Set-Cookie', cookie(OAUTH_COOKIE, '', { maxAgeSeconds: 0, secure: config.secureCookies }));
      setSession(res, config, { email, name: claims.name || displayName(email), method: 'microsoft' }, { remember: pending.remember === true });
      return res.redirect('/');
    } catch (error) {
      console.error('Microsoft sign-in failed:', error.message);
      return fail('sign_in_failed');
    }
  });

  return router;
}

// API routes need a session once sign-in is on. Sign-in itself, `isPublic`
// routes and service-to-service calls (the AI agent, with its service token) pass.
export function requireSession({ config, serviceToken, serviceHeader, isPublic = () => false }) {
  return (req, res, next) => {
    if (!config.required) return next();
    if (req.path.startsWith('/auth/') || isPublic(req)) return next();
    if (serviceToken && serviceTokenMatches(req.get(serviceHeader), serviceToken)) return next();
    if (sessionFromRequest(req, config)) return next();
    return res.status(401).json({ error: 'Sign in required', signIn: true });
  };
}
