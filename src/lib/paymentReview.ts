// Review a payment straight from the admin notification email.
//
// Every "new payment submitted" email (therapy booking, workshop signup,
// paid course) now carries two links:
//   - the payment screenshot, and
//   - a "Review & approve" button.
// Neither needs a dashboard login: each link carries a signed token (HMAC
// over kind + id + expiry, keyed with ADMIN_SESSION_SECRET) that only this
// server can produce, valid for that one item only. The emails go to the
// admin/team inbox, so holding the email is the credential -- same trust
// level as the dashboard password reset-by-inbox pattern.
//
// Approving from here does EXACTLY what the dashboard's approve button does
// (same status change, same confirmation email to the client), so the two
// stay in sync: whichever you use first wins, and the other one shows
// "already approved" instead of doing it twice. The UPDATE is conditional on
// status = 'pending', so even two people clicking at the same moment can't
// double-approve or double-email the client.
//
// Opening the link (GET) never changes anything -- it only shows the details
// and screenshot. Approval only happens on the button press (POST). That
// matters because mail scanners (Outlook Safe Links, Gmail, antivirus)
// routinely "click" every link in an email to check it; if the link itself
// approved, a scanner could approve payments nobody looked at.

import { sendBookingStatusEmail, sendWorkshopEnrollmentStatusEmail } from './email';
import { sendCourseEnrollmentStatusEmail } from './email-brevo';

export type ReviewKind = 'booking' | 'workshop' | 'course';

export function isReviewKind(value: unknown): value is ReviewKind {
  return value === 'booking' || value === 'workshop' || value === 'course';
}

// ---------- Signed tokens ----------

const TOKEN_LIFETIME_MS = 1000 * 60 * 60 * 24 * 30; // 30 days -- after that, use the dashboard

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

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// The "review:" prefix keeps these signatures from ever being valid as
// anything else that is signed with the same secret (e.g. session cookies).
function tokenMessage(kind: ReviewKind, id: string, expires: number): string {
  return `review:${kind}:${id}:${expires}`;
}

export async function signReviewToken(secret: string, kind: ReviewKind, id: string): Promise<string> {
  const expires = Date.now() + TOKEN_LIFETIME_MS;
  const signature = await hmac(secret, tokenMessage(kind, id, expires));
  return `${expires}.${signature}`;
}

export async function verifyReviewToken(
  secret: string | undefined,
  kind: ReviewKind,
  id: string,
  token: string | null | undefined
): Promise<boolean> {
  if (!secret || !token) return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const expires = Number(token.slice(0, dot));
  const signature = token.slice(dot + 1);
  if (!Number.isFinite(expires) || Date.now() > expires) return false;
  const expected = await hmac(secret, tokenMessage(kind, id, expires));
  return safeEqual(expected, signature);
}

export interface ReviewLinks {
  reviewUrl: string;
  screenshotUrl: string;
}

// Called by the three submission endpoints right after the row is saved.
// Returns null when the secret isn't configured; the emails then simply
// leave the buttons out and point at the dashboard, exactly as before.
export async function makeReviewLinks(
  origin: string,
  secret: string | undefined,
  kind: ReviewKind,
  id: string | number
): Promise<ReviewLinks | null> {
  if (!secret) return null;
  const idStr = String(id);
  const token = await signReviewToken(secret, kind, idStr);
  const enc = encodeURIComponent(idStr);
  return {
    reviewUrl: `${origin}/api/review/${kind}/${enc}?t=${token}`,
    screenshotUrl: `${origin}/api/review/shot/${kind}/${enc}?t=${token}`,
  };
}

// ---------- Looking up an item ----------

export type ReviewStatus = 'pending' | 'approved' | 'declined' | 'other';

export interface ReviewItem {
  kind: ReviewKind;
  id: string;
  heading: string;
  details: Array<[string, string]>;
  status: ReviewStatus;
  reviewedAt: string | null;
  screenshotKey: string | null;
  screenshotType: string | null;
}

const PAYMENT_LABELS: Record<string, string> = {
  jazzcash: 'JazzCash',
  bank_hbl: 'Bank transfer (HBL)',
  bank_ubl: 'Bank transfer (UBL)',
  easypaisa: 'Easypaisa',
  bank: 'Bank transfer',
};
const CLINICIAN_NAMES: Record<string, string> = { sohail: 'Muhammad Sohail', sehar: 'Sehar Waheed' };

function paymentLabel(method: string | null): string {
  return (method && PAYMENT_LABELS[method]) || method || '—';
}

function mapStatus(kind: ReviewKind, raw: string | null): ReviewStatus {
  if (raw === 'pending') return 'pending';
  if (raw === 'declined') return 'declined';
  // Bookings say 'confirmed'; workshop signups and course enrollments say 'active'.
  if (kind === 'booking' ? raw === 'confirmed' : raw === 'active') return 'approved';
  return 'other';
}

export async function loadReviewItem(env: any, kind: ReviewKind, id: string): Promise<ReviewItem | null> {
  if (!env?.DB) return null;

  if (kind === 'booking') {
    const r = await env.DB.prepare(
      `SELECT id, client_name, email, phone, service, clinician, preferred_time, mode, amount_pkr,
              payment_method, notes, screenshot_key, screenshot_type, status
       FROM bookings WHERE id = ?`
    ).bind(id).first();
    if (!r) return null;
    const details: Array<[string, string]> = [
      ['Reference', r.id],
      ['Client', r.client_name],
      ['Email', r.email],
      ['Phone', r.phone],
      ['Service', `${r.service === 'couples' ? 'Couples Therapy' : 'Individual Therapy'} (${r.mode === 'in_person' ? 'in person' : 'online'})`],
      ['Clinician', CLINICIAN_NAMES[r.clinician] || r.clinician],
      ['Time', r.preferred_time],
      ['Amount', `PKR ${r.amount_pkr} via ${paymentLabel(r.payment_method)}`],
    ];
    if (r.notes) details.push(['Notes', r.notes]);
    return {
      kind, id: r.id, heading: 'Therapy booking', details,
      status: mapStatus(kind, r.status), reviewedAt: null,
      screenshotKey: r.screenshot_key ?? null, screenshotType: r.screenshot_type ?? null,
    };
  }

  if (kind === 'workshop') {
    const r = await env.DB.prepare(
      `SELECT id, workshop_title, name, email, phone, amount_pkr, payment_method, notes, status, reviewed_at,
              screenshot_key, screenshot_type
       FROM workshop_enrollments WHERE id = ?`
    ).bind(id).first();
    if (!r) return null;
    const details: Array<[string, string]> = [
      ['Reference', r.id],
      ['Workshop', r.workshop_title],
      ['Name', r.name],
      ['Email', r.email],
      ['Phone', r.phone],
      ['Amount', `PKR ${r.amount_pkr} via ${paymentLabel(r.payment_method)}`],
    ];
    if (r.notes) details.push(['Notes', r.notes]);
    return {
      kind, id: r.id, heading: 'Workshop signup', details,
      status: mapStatus(kind, r.status), reviewedAt: r.reviewed_at ?? null,
      screenshotKey: r.screenshot_key ?? null, screenshotType: r.screenshot_type ?? null,
    };
  }

  // course -- ids are integers
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;
  const r = await env.DB.prepare(
    `SELECT id, course_title, name, email, amount_pkr, payment_method, status, reviewed_at,
            screenshot_key, screenshot_type
     FROM enrollments WHERE id = ? AND amount_pkr IS NOT NULL`
  ).bind(numericId).first();
  if (!r) return null;
  return {
    kind, id: String(r.id), heading: 'Paid course enrollment',
    details: [
      ['Course', r.course_title],
      ['Learner', r.name],
      ['Email', r.email],
      ['Amount', `PKR ${r.amount_pkr} via ${paymentLabel(r.payment_method)}`],
    ],
    status: mapStatus(kind, r.status), reviewedAt: r.reviewed_at ?? null,
    screenshotKey: r.screenshot_key ?? null, screenshotType: r.screenshot_type ?? null,
  };
}

// ---------- Approving ----------

export type ApproveOutcome = 'approved' | 'already' | 'declined' | 'unavailable' | 'notfound';

// Mirrors the dashboard's PATCH handlers, plus the status = 'pending' guard.
// Approving only ever moves a PENDING item to approved. Something already
// approved reports "already"; something declined earlier is left alone and
// reported as such (reversing a decline stays a deliberate dashboard action).
export async function approveReviewItem(env: any, kind: ReviewKind, id: string, origin: string): Promise<ApproveOutcome> {
  if (!env?.DB) return 'unavailable';
  const now = new Date().toISOString();
  let claimed = false;

  if (kind === 'booking') {
    const row = await env.DB.prepare(
      `UPDATE bookings SET status = 'confirmed' WHERE id = ? AND status = 'pending'
       RETURNING id, client_name, email, service, clinician, preferred_time, mode`
    ).bind(id).first();
    if (row) {
      claimed = true;
      // Best-effort, same as the dashboard: a failed email never undoes the approval.
      await sendBookingStatusEmail(env, {
        toEmail: row.email, toName: row.client_name, status: 'confirmed', service: row.service,
        clinician: row.clinician, mode: row.mode, preferredTime: row.preferred_time, reference: row.id,
      }).catch(() => {});
    }
  } else if (kind === 'workshop') {
    const row = await env.DB.prepare(
      `UPDATE workshop_enrollments SET status = 'active', reviewed_at = ? WHERE id = ? AND status = 'pending'
       RETURNING workshop_title, name, email`
    ).bind(now, id).first();
    if (row) {
      claimed = true;
      await sendWorkshopEnrollmentStatusEmail(env, {
        toEmail: row.email, toName: row.name, workshopTitle: row.workshop_title, status: 'active',
      }).catch(() => {});
    }
  } else {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) return 'notfound';
    const row = await env.DB.prepare(
      `UPDATE enrollments SET status = 'active', reviewed_at = ?
       WHERE id = ? AND amount_pkr IS NOT NULL AND status = 'pending'
       RETURNING course_slug, course_title, name, email`
    ).bind(now, numericId).first();
    if (row) {
      claimed = true;
      await sendCourseEnrollmentStatusEmail(env, {
        toEmail: row.email, toName: row.name, courseTitle: row.course_title, status: 'active',
        courseUrl: `${origin}/courses/${row.course_slug}`,
      }).catch(() => {});
    }
  }

  if (claimed) return 'approved';

  // Nothing was pending -- find out why so the page can say so plainly.
  const item = await loadReviewItem(env, kind, id);
  if (!item) return 'notfound';
  if (item.status === 'approved') return 'already';
  if (item.status === 'declined') return 'declined';
  return 'unavailable';
}
