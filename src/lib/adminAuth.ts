// Signed-cookie session for the dashboard, now carrying a role:
// 'admin' | 'sohail' | 'sehar'. No external auth library — just an HMAC
// over "expires.role", signed with a secret only you know.

const COOKIE_NAME = 'tps_admin_session';
const SESSION_LENGTH_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export type Role = 'admin' | 'sohail' | 'sehar';

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function createSessionCookie(secret: string, role: Role): Promise<string> {
  const expires = Date.now() + SESSION_LENGTH_MS;
  const payload = `${expires}.${role}`;
  const signature = await hmac(secret, payload);
  const value = `${payload}.${signature}`;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_LENGTH_MS / 1000}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function getSession(cookieHeader: string | null, secret: string): Promise<{ role: Role } | null> {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;

  const parts = match[1].split('.');
  if (parts.length !== 3) return null;
  const [expiresStr, role, signature] = parts;

  const payload = `${expiresStr}.${role}`;
  const expected = await hmac(secret, payload);
  if (expected !== signature) return null;

  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || Date.now() > expires) return null;
  if (role !== 'admin' && role !== 'sohail' && role !== 'sehar') return null;

  return { role };
}
