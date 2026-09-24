// Signed-cookie session for learners viewing "My Certificates" — same
// pattern as adminAuth.ts (HMAC over a payload, no external library), just
// carrying an email instead of a role, and reached via a magic link
// instead of a password.

const COOKIE_NAME = 'tps_client_session';
const SESSION_LENGTH_MS = 1000 * 60 * 60 * 24 * 30; // 30 days — this is a low-stakes, read-only session

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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createClientSessionCookie(secret: string, email: string, secure: boolean = true): Promise<string> {
  const normalized = normalizeEmail(email);
  const expires = Date.now() + SESSION_LENGTH_MS;
  // Base64 the email so it can't smuggle a '.' and confuse the payload split.
  const encodedEmail = btoa(unescape(encodeURIComponent(normalized)));
  const payload = `${expires}.${encodedEmail}`;
  const signature = await hmac(secret, payload);
  const value = `${payload}.${signature}`;
  // `Secure` is only added when the request is actually HTTPS (i.e. never
  // on local http://localhost dev) -- browsers silently drop `Secure`
  // cookies over plain HTTP, which would otherwise make sign-in look
  // "successful" but never actually stick when testing locally.
  const secureAttr = secure ? ' Secure;' : '';
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly;${secureAttr} SameSite=Lax; Max-Age=${SESSION_LENGTH_MS / 1000}`;
}

export function clearClientSessionCookie(secure: boolean = true): string {
  const secureAttr = secure ? ' Secure;' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly;${secureAttr} SameSite=Lax; Max-Age=0`;
}

export async function getClientSession(cookieHeader: string | null, secret: string): Promise<{ email: string } | null> {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;

  const parts = match[1].split('.');
  if (parts.length !== 3) return null;
  const [expiresStr, encodedEmail, signature] = parts;

  const payload = `${expiresStr}.${encodedEmail}`;
  const expected = await hmac(secret, payload);
  if (expected !== signature) return null;

  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || Date.now() > expires) return null;

  let email: string;
  try {
    email = decodeURIComponent(escape(atob(encodedEmail)));
  } catch {
    return null;
  }
  if (!email) return null;

  return { email };
}

// ---------------------------------------------------------------------------
// Display name, set at Google sign-in. Kept in its OWN cookie (rather than
// widening the session cookie above) so the session format that every page
// already parses is untouched -- existing logged-in learners stay logged in.
// It's signed and bound to the email, so it can't be reused on another
// account. It exists so "Enroll now" can be a single click: the name that
// goes on the certificate is already known.
// ---------------------------------------------------------------------------
const NAME_COOKIE_NAME = 'tps_client_name';

export async function createClientNameCookie(secret: string, email: string, name: string, secure: boolean = true): Promise<string> {
  const encodedName = btoa(unescape(encodeURIComponent(name.trim().slice(0, 200))));
  const signature = await hmac(secret, `name:${normalizeEmail(email)}:${encodedName}`);
  const secureAttr = secure ? ' Secure;' : '';
  return `${NAME_COOKIE_NAME}=${encodedName}.${signature}; Path=/; HttpOnly;${secureAttr} SameSite=Lax; Max-Age=${SESSION_LENGTH_MS / 1000}`;
}

export function clearClientNameCookie(secure: boolean = true): string {
  const secureAttr = secure ? ' Secure;' : '';
  return `${NAME_COOKIE_NAME}=; Path=/; HttpOnly;${secureAttr} SameSite=Lax; Max-Age=0`;
}

export async function getClientName(cookieHeader: string | null, secret: string, email: string): Promise<string | null> {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${NAME_COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  const [encodedName, signature] = match[1].split('.');
  if (!encodedName || !signature) return null;
  const expected = await hmac(secret, `name:${normalizeEmail(email)}:${encodedName}`);
  if (expected !== signature) return null;
  try {
    const name = decodeURIComponent(escape(atob(encodedName))).trim();
    return name || null;
  } catch {
    return null;
  }
}
