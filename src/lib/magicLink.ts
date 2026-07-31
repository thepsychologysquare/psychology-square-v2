// Short-lived, one-time magic-link tokens for the passwordless "My
// Certificates" login. Uses the SESSION KV namespace (already bound in
// wrangler.jsonc, previously unused) — KV's native expirationTtl means we
// don't need any cleanup job for expired tokens.

const TOKEN_TTL_SECONDS = 60 * 15; // 15 minutes
const KV_PREFIX = 'magiclink:';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function makeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function createMagicLinkToken(kv: KVNamespace, email: string): Promise<string> {
  const token = makeToken();
  await kv.put(`${KV_PREFIX}${token}`, normalizeEmail(email), { expirationTtl: TOKEN_TTL_SECONDS });
  return token;
}

// One-time use: consuming a token deletes it immediately, so a link that's
// already been clicked (or is being replayed) fails on the second attempt.
export async function consumeMagicLinkToken(kv: KVNamespace, token: string): Promise<string | null> {
  if (!token || token.length > 200) return null;
  const key = `${KV_PREFIX}${token}`;
  const email = await kv.get(key);
  if (!email) return null;
  await kv.delete(key);
  return email;
}
