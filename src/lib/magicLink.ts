// Short-lived, one-time magic-link tokens for passwordless login — used
// both for "My Certificates" and for enrolling in a course.
//
// Stored in D1 (not KV): KV is only *eventually* consistent across
// Cloudflare's edge locations, so a token written by one request could
// briefly be invisible to a verification request from a different
// location moments later — the likely cause of links intermittently
// coming back "expired" right after being sent. D1 has one consistent
// primary, so a token is reliably readable the instant it's written.

const TOKEN_TTL_MS = 1000 * 60 * 15; // 15 minutes

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

export type MagicLinkPayload = {
  email: string;
  redirectPath?: string;
  enrollCourseSlug?: string;
  enrollName?: string;
};

export async function createMagicLinkToken(db: D1Database, payload: MagicLinkPayload): Promise<string> {
  const token = makeToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  await db.prepare(
    `INSERT INTO magic_link_tokens (token, email, redirect_path, enroll_course_slug, enroll_name, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    token,
    normalizeEmail(payload.email),
    payload.redirectPath || null,
    payload.enrollCourseSlug || null,
    payload.enrollName || null,
    expiresAt
  ).run();
  return token;
}

// One-time use: consuming a token deletes it immediately, so a link
// that's already been clicked (or is being replayed) fails on the next attempt.
export async function consumeMagicLinkToken(db: D1Database, token: string): Promise<MagicLinkPayload | null> {
  if (!token || token.length > 200) return null;

  const row = await db.prepare(
    `SELECT email, redirect_path, enroll_course_slug, enroll_name, expires_at FROM magic_link_tokens WHERE token = ?`
  ).bind(token).first<{
    email: string; redirect_path: string | null; enroll_course_slug: string | null;
    enroll_name: string | null; expires_at: string;
  }>();

  if (!row) return null;
  await db.prepare(`DELETE FROM magic_link_tokens WHERE token = ?`).bind(token).run();

  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  return {
    email: row.email,
    redirectPath: row.redirect_path || undefined,
    enrollCourseSlug: row.enroll_course_slug || undefined,
    enrollName: row.enroll_name || undefined,
  };
}

// Opportunistic cleanup — called occasionally rather than on a schedule,
// since D1 has no built-in TTL the way KV does.
export async function cleanupExpiredTokens(db: D1Database): Promise<void> {
  await db.prepare(`DELETE FROM magic_link_tokens WHERE expires_at < ?`).bind(new Date().toISOString()).run();
}
