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
  const secret = process.env.SESSION_SECRET || process.env.SUPABASE_SECRET_KEY || 'dnassets-survey-session-secret-2026';
  const access = new Map(), refreshMap = new Map();
  const revoked = new Set();

  function signToken(payload) {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    return `${data}.${sig}`;
  }

  function verifyToken(token, expectedType) {
    if (!token || typeof token !== 'string' || revoked.has(token)) return null;
    const parts = token.split('.');
    if (parts.length === 2) {
      const [data, sig] = parts;
      const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
      if (sig.length === expectedSig.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
        try {
          const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
          if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
          if (expectedType && payload.type !== expectedType) return null;
          return payload;
        } catch {
          return null;
        }
      }
    }
    // Backward compatibility with local in-memory Map
    const s = access.get(token) || refreshMap.get(token);
    if (s && s.expires_at > Math.floor(Date.now() / 1000)) {
      if (!expectedType || s.type === expectedType) return s;
    }
    return null;
  }

  const revoke = token => {
    if (token) revoked.add(token);
    const s = access.get(token) || refreshMap.get(token);
    if (s) { access.delete(s.access_token); refreshMap.delete(s.refresh_token); }
  };

  return {
    issue(user) {
      const now = Math.floor(Date.now() / 1000);
      const expires_at = now + 86400; // 24 hours
      const refreshExpires = now + (7 * 86400); // 7 days
      const access_token = signToken({ sub: user.id, email: user.email, exp: expires_at, type: 'access' });
      const refresh_token = signToken({ sub: user.id, email: user.email, exp: refreshExpires, type: 'refresh' });
      const s = { sub: user.id, email: user.email, access_token, refresh_token, expires_at, refreshExpires: refreshExpires * 1000 };
      access.set(access_token, s);
      refreshMap.set(refresh_token, s);
      return { access_token, refresh_token, expires_at };
    },
    verify(token) {
      return verifyToken(token, 'access');
    },
    refresh(token) {
      const s = verifyToken(token, 'refresh');
      if (!s) return null;
      revoke(token);
      return this.issue({ id: s.sub, email: s.email });
    },
    revoke,
    revokeUser(id) {
      for (const [token, s] of access) if (s.sub === id) revoke(token);
    }
  };
}
