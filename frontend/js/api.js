const base = () => window.DNASSETS_CONFIG?.apiBaseUrl?.replace(/\/$/, '') || '';
let session;
try { session = JSON.parse(sessionStorage.getItem('dnassets-session') || 'null'); } catch { session = null; }
let refreshing;
export const hasSession = () => Boolean(session);
export function setSession(value) {
  session = value;
  if (value) sessionStorage.setItem('dnassets-session', JSON.stringify(value));
  else {sessionStorage.removeItem('dnassets-session');for(const key of Object.keys(sessionStorage))if(key.startsWith('dnassets-unlock-')||key==='dnassets-active-project')sessionStorage.removeItem(key);}
}

export function getProjectUnlockToken(projectId) {
  try { return sessionStorage.getItem(`dnassets-unlock-${projectId}`); } catch { return null; }
}

export function setProjectUnlockToken(projectId, token) {
  try {
    if (token) sessionStorage.setItem(`dnassets-unlock-${projectId}`, token);
    else sessionStorage.removeItem(`dnassets-unlock-${projectId}`);
  } catch {}
}

async function refresh() {
  if (!refreshing) refreshing = (async () => {
    const r = await fetch(base() + '/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    if (!r.ok) {
      setSession(null);
      window.dispatchEvent(new Event('session-expired'));
      throw new Error('Session expired. Sign in again.');
    }
    setSession(await r.json());
  })().finally(() => refreshing = null);
  return refreshing;
}

export async function api(path, { method = 'GET', body, headers: customHeaders, blob = false, publicRequest = false } = {}) {
  if (session && !publicRequest && session.expires_at * 1000 < Date.now() + 60000) await refresh();
  const headers = { ...customHeaders };
  if (session && !publicRequest) headers.Authorization = `Bearer ${session.access_token}`;
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const projectMatch = path.match(/projects\/([0-9a-fA-F-]{36})/);
  if (projectMatch) {
    const token = getProjectUnlockToken(projectMatch[1]);
    if (token) headers['X-Project-Unlock-Token'] = token;
  }
  const propertyMatch = path.match(/properties\/([0-9a-fA-F-]{36})/);
  if (propertyMatch) {
    const activeProject = sessionStorage.getItem('dnassets-active-project');
    if (activeProject) {
      const token = getProjectUnlockToken(activeProject);
      if (token) headers['X-Project-Unlock-Token'] = token;
    }
  }

  const response = await fetch(base() + '/api' + path, {
    method,
    headers,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    let data;
    try { data = await response.json(); } catch { data = { error: 'The server could not complete this request.' }; }
    if (response.status === 401 && !publicRequest) {
      setSession(null);
      window.dispatchEvent(new Event('session-expired'));
    }
    const err = new Error(data.error || data.message || 'Request failed');
    err.status = response.status;
    err.code = data.code;
    err.projectId = data.projectId;
    throw err;
  }
  if (response.status === 204) return null;
  return blob ? response.blob() : response.json();
}
