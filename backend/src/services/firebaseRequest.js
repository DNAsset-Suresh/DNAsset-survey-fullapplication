import { AsyncLocalStorage } from 'node:async_hooks';
import { initializeServerApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { fail } from '../validators.js';

const requests = new AsyncLocalStorage();

export function requestFirebase() {
  const context = requests.getStore();
  if (!context) throw fail(503, 'An authenticated Firebase request is required.');
  return context;
}

// Each request resumes its own Firebase identity, including on a new Vercel worker.
// No process-global currentUser or custom token signing secret is involved.
export function firebaseRequestMiddleware(config) {
  return (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    const app = initializeServerApp(config, { ...(token ? { authIdToken: token } : {}), releaseOnDeref: req });
    const auth = getAuth(app);
    requests.run({ app, auth, token, config, firestore: getFirestore(app), storage: getStorage(app), actor: null }, () => next());
  };
}

export async function firebaseAuthRequest(config, operation, values, fetcher = fetch) {
  const isRefresh = operation === 'refresh';
  const url = isRefresh ? 'https://securetoken.googleapis.com/v1/token' : `https://identitytoolkit.googleapis.com/v1/accounts:${operation}`;
  let response;
  try {
    response = await fetcher(`${url}?key=${encodeURIComponent(config.apiKey)}`, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': isRefresh ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: isRefresh ? new URLSearchParams(values).toString() : JSON.stringify(values)
    });
  } catch { throw fail(503, 'The sign-in service could not be reached. Please try again.'); }
  const data = await response.json();
  if (!response.ok) {
    const code = data.error?.message || '';
    if (/TOO_MANY_ATTEMPTS/.test(code)) throw fail(429, 'Too many sign-in attempts. Please try again later.');
    if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_EMAIL/.test(code)) throw fail(401, 'Email or password is incorrect.');
    if (/TOKEN_EXPIRED|INVALID_ID_TOKEN|INVALID_REFRESH_TOKEN|USER_DISABLED|USER_NOT_FOUND/.test(code)) throw fail(401, 'Session expired. Please sign in again.');
    if (/CREDENTIAL_TOO_OLD_LOGIN_AGAIN/.test(code)) throw fail(401, 'Please sign in again before changing your password.');
    throw fail(503, 'The authentication service is unavailable or not configured correctly.');
  }
  return data;
}

export function firebaseSession(result) {
  const access_token = result.idToken || result.id_token;
  const refresh_token = result.refreshToken || result.refresh_token;
  const seconds = Number(result.expiresIn || result.expires_in);
  if (!access_token || !refresh_token || !Number.isFinite(seconds) || seconds <= 0) throw fail(502, 'The sign-in service returned an invalid session.');
  return { access_token, refresh_token, expires_at: Math.floor(Date.now() / 1000) + seconds };
}

export function normalizeLoginEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  return ({ admin: 'admin@dnassets.com', administrator: 'admin@dnassets.com', reviewer: 'reviewer@dnassets.com', naresh: 'reviewer@dnassets.com', dna: 'dna.callus@gmail.com', suresh: 'dna.callus@gmail.com', callus: 'dna.callus@gmail.com', user: 'user@dnassets.com', founder: 'founder@dnassets.com', viewer: 'viewer@dnassets.com' })[value] || value;
}
