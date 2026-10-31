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
  const access=new Map(), refresh=new Map();
  const revoke = token => { const s=access.get(token)||refresh.get(token); if(s) {access.delete(s.access_token);refresh.delete(s.refresh_token);} };
  return {
    issue(user) {
      for(const [token,s] of refresh) if(s.refreshExpires<Date.now()) revoke(token);
      const s={sub:user.id,email:user.email,access_token:crypto.randomBytes(32).toString('base64url'),refresh_token:crypto.randomBytes(32).toString('base64url'),expires_at:Math.floor(Date.now()/1000)+3600,refreshExpires:Date.now()+86400000};
      access.set(s.access_token,s);refresh.set(s.refresh_token,s);
      return {access_token:s.access_token,refresh_token:s.refresh_token,expires_at:s.expires_at};
    },
    verify(token) {const s=access.get(token);return s&&s.expires_at> Date.now()/1000?s:null;},
    refresh(token) {const s=refresh.get(token);if(!s||s.refreshExpires<Date.now())return null;revoke(token);return this.issue({id:s.sub,email:s.email});},
    revoke,
    revokeUser(id) {for(const [token,s] of access) if(s.sub===id)revoke(token);}
  };
}
