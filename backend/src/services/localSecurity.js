import crypto from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
const scrypt = promisify(crypto.scrypt);
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function checkPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  if (stored.startsWith('scrypt:')) {
    const [,salt,key] = stored.split(':');
    const actual = await scrypt(password,salt,64);
    const expected = Buffer.from(key,'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(actual,expected);
  }
  // Legacy local passwords remain usable until a successful login upgrades them.
  const a=Buffer.from(password), b=Buffer.from(stored);
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}
export function containedPath(root,...parts) {
  const target=path.resolve(root,...parts), relative=path.relative(path.resolve(root),target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Invalid storage path');
  return target;
}
export function sessionStore() {
  // Local sessions are opaque, process-bound and revoked as a pair.
  // Firebase uses its own verified ID tokens instead of this local store.
  const access = new Map(), refreshMap = new Map();
  function revoke(token) {
    const session = access.get(token) || refreshMap.get(token);
    if (session) { access.delete(session.access_token); refreshMap.delete(session.refresh_token); }
  }
  return {
    issue(user) {
      const now = Date.now();
      for (const [token, session] of refreshMap) if (session.refreshExpires <= now) revoke(token);
      const session = { sub: user.id, email: user.email, access_token: crypto.randomBytes(32).toString('base64url'), refresh_token: crypto.randomBytes(48).toString('base64url'), expires_at: Math.floor(now / 1000) + 3600, refreshExpires: now + 7 * 86400000 };
      access.set(session.access_token, session); refreshMap.set(session.refresh_token, session);
      return { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at };
    },
    verify(token) { const session = access.get(token); return session && session.expires_at > Date.now() / 1000 ? session : null; },
    refresh(token) {
      const session = refreshMap.get(token);
      if (!session || session.refreshExpires <= Date.now()) { revoke(token); return null; }
      revoke(token); return this.issue({ id: session.sub, email: session.email });
    },
    revoke,
    revokeUser(id) { for (const [token, session] of access) if (session.sub === id) revoke(token); }
  };
}
