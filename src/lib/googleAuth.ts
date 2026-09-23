// Google OAuth 2.0 (Authorization Code flow) for learner sign-in — replaces
// the old email magic-link flow entirely. No tokens are stored server-side:
// the redirect target and (optional) course-to-enroll are packed into a
// signed, short-lived `state` param instead of a DB row, so there's nothing
// to clean up and no email quota involved in signing in at all.
//
// Requires on the Worker:
//   - GOOGLE_CLIENT_ID       (var)    — from Google Cloud Console -> OAuth client
//   - GOOGLE_CLIENT_SECRET   (secret) — same OAuth client
//   - CLIENT_SESSION_SECRET  (secret) — already used to sign the session
//                                        cookie; reused here to sign `state`
//
// Authorized redirect URI in Google Cloud Console must exactly match
// `<your-domain>/api/auth/google/callback` (add both prod and any preview/
// local URLs you test from).

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

const STATE_TTL_MS = 1000 * 60 * 10; // 10 minutes — plenty for a login round-trip

type OAuthStatePayload = {
  redirectPath?: string;
  enrollCourseSlug?: string;
};

type OAuthState = OAuthStatePayload & {
  nonce: string;
  issuedAt: number;
};

// Signs {redirectPath, enrollCourseSlug, nonce, issuedAt} so the callback
// can trust it came from us and hasn't expired or been replayed stale,
// without needing to look anything up in D1.
export async function createOAuthState(secret: string, payload: OAuthStatePayload): Promise<string> {
  const data: OAuthState = { ...payload, nonce: crypto.randomUUID(), issuedAt: Date.now() };
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  const signature = await hmac(secret, encoded);
  return `${encoded}.${signature}`;
}

export async function verifyOAuthState(secret: string, state: string): Promise<OAuthState | null> {
  if (!state || state.length > 2000) return null;
  const [encoded, signature] = state.split('.');
  if (!encoded || !signature) return null;

  const expected = await hmac(secret, encoded);
  if (expected !== signature) return null;

  let data: OAuthState;
  try {
    data = JSON.parse(decodeURIComponent(escape(atob(encoded))));
  } catch {
    return null;
  }
  if (!data.issuedAt || Date.now() - data.issuedAt > STATE_TTL_MS) return null;

  return data;
}

export function googleAuthorizationUrl(opts: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', opts.state);
  url.searchParams.set('access_type', 'online');
  // Always show the account chooser rather than silently reusing whatever
  // Google session happens to be active in the browser -- avoids someone
  // on a shared computer accidentally signing in as the wrong person.
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export type GoogleProfile = {
  email: string;
  name: string;
};

// Exchanges the authorization code for an access token, then calls Google's
// userinfo endpoint to get a verified email + name. Using the userinfo
// endpoint (instead of decoding the ID token JWT ourselves) means we don't
// need a JWT/JWKS-verification library on the Worker -- Google has already
// authenticated the bearer token by the time it returns this response.
export async function exchangeCodeForProfile(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GoogleProfile | null> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    console.error(`[googleAuth] token exchange failed: ${tokenRes.status} ${await tokenRes.text().catch(() => '')}`);
    return null;
  }
  const tokenData = await tokenRes.json<{ access_token?: string }>();
  if (!tokenData.access_token) return null;

  const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!profileRes.ok) {
    console.error(`[googleAuth] userinfo fetch failed: ${profileRes.status}`);
    return null;
  }
  const profile = await profileRes.json<{ email?: string; email_verified?: boolean; name?: string }>();

  // Reject unverified emails -- someone could otherwise register a Google
  // Workspace account under an email they don't actually control.
  if (!profile.email || profile.email_verified !== true) return null;

  return {
    email: profile.email.trim().toLowerCase(),
    name: (profile.name || profile.email).trim().slice(0, 200),
  };
}
