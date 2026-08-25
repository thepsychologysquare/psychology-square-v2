import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getWorkshopBySlug, countActiveEnrollments } from '../../lib/workshops';
import { sendNewWorkshopEnrollmentAdminEmail, sendWorkshopEnrollmentReceivedEmail } from '../../lib/email';

export const prerender = false;

// Same payment-proof-first pattern as /api/bookings.ts: no login, no slot
// to claim -- just submit your details + a screenshot, and it sits as
// 'pending' until an admin reviews it. The one addition over a booking is
// a capacity check: once a workshop is 'confirmed' or already at max
// seats, new signups are turned away instead of silently piling up behind
// a session that's already happening.

const PAYMENT_METHODS = new Set(['jazzcash', 'bank_hbl', 'bank_ubl']);
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5MB — same limit as booking/course screenshots
const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_SUBMISSIONS = 4;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()\-\s]{7,20}$/;

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeReference(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `TPS-W${code}`;
}

export const POST: APIRoute = async ({ request }) => {
  if (!env?.DB || !env?.SCREENSHOTS) {
    return jsonError('Workshop signup is not configured yet.', 500);
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
  const recentCount = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM workshop_enrollments WHERE submitter_ip = ? AND created_at > ?`
  ).bind(ip, windowStart).first<{ count: number }>();
  if (recentCount && recentCount.count >= RATE_LIMIT_MAX_SUBMISSIONS) {
    return jsonError('Too many submissions from this connection. Please try again later, or email us directly.', 429);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError('Could not read the submitted form.', 400);
  }

  const workshopSlug = String(formData.get('workshop_slug') || '').trim();
  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  const notes = String(formData.get('notes') || '').trim();
  const paymentMethod = String(formData.get('payment_method') || '');
  const screenshot = formData.get('screenshot');

  if (!workshopSlug) return jsonError('Missing workshop.', 400);
  if (!name || name.length > 200) return jsonError('Please enter your name.', 400);
  if (!email || email.length > 200 || !EMAIL_RE.test(email)) return jsonError('Please enter a valid email address.', 400);
  if (!phone || phone.length > 40 || !PHONE_RE.test(phone)) return jsonError('Please enter a valid phone number.', 400);
  if (notes.length > 1000) return jsonError('Notes are too long.', 400);
  if (!PAYMENT_METHODS.has(paymentMethod)) return jsonError('Please choose a valid payment method.', 400);

  if (!(screenshot instanceof File) || screenshot.size === 0) {
    return jsonError('Please attach a screenshot of your payment.', 400);
  }
  if (screenshot.size > MAX_SCREENSHOT_BYTES) {
    return jsonError('That screenshot is too large — please attach one under 5MB.', 400);
  }
  if (!screenshot.type.startsWith('image/')) {
    return jsonError('Please attach an image file.', 400);
  }

  const workshop = await getWorkshopBySlug(env, workshopSlug);
  if (!workshop || workshop.draft) return jsonError('Workshop not found.', 404);
  if (workshop.max_seats != null) {
    const activeCount = await countActiveEnrollments(env, workshopSlug);
    if (activeCount >= workshop.max_seats) {
      return jsonError('This workshop is full. Please check back for the next one, or get in touch to be waitlisted.', 409);
    }
  }

  const existing = await env.DB.prepare(
    `SELECT status FROM workshop_enrollments WHERE workshop_slug = ? AND email = ?`
  ).bind(workshopSlug, email).first<{ status: string }>();
  if (existing?.status === 'active') {
    return jsonError('You\u2019re already signed up for this workshop.', 400);
  }

  const reference = makeReference();
  const extension = screenshot.type.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'jpg';
  const screenshotKey = `workshop-${reference}.${extension}`;

  try {
    await env.SCREENSHOTS.put(screenshotKey, await screenshot.arrayBuffer(), {
      httpMetadata: { contentType: screenshot.type },
    });
  } catch {
    return jsonError('Could not save your screenshot. Please try again.', 500);
  }

  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO workshop_enrollments
        (id, workshop_slug, workshop_title, name, email, phone, notes, amount_pkr, payment_method, screenshot_key, screenshot_type, status, submitter_ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(workshop_slug, email) DO UPDATE SET
         id = excluded.id,
         name = excluded.name,
         phone = excluded.phone,
         notes = excluded.notes,
         amount_pkr = excluded.amount_pkr,
         payment_method = excluded.payment_method,
         screenshot_key = excluded.screenshot_key,
         screenshot_type = excluded.screenshot_type,
         status = 'pending',
         submitter_ip = excluded.submitter_ip,
         created_at = excluded.created_at,
         reviewed_at = NULL`
    ).bind(
      reference, workshopSlug, workshop.title, name, email, phone, notes || null,
      workshop.price_pkr, paymentMethod, screenshotKey, screenshot.type, ip, now
    ).run();
  } catch {
    await env.SCREENSHOTS.delete(screenshotKey).catch(() => {});
    return jsonError('Could not save your signup. Please try again.', 500);
  }

  await sendWorkshopEnrollmentReceivedEmail(env, {
    toEmail: email, toName: name, workshopTitle: workshop.title, reference,
  }).catch(() => {});

  await sendNewWorkshopEnrollmentAdminEmail(env, {
    reference, name, email, phone, workshopTitle: workshop.title,
    amountPkr: workshop.price_pkr, paymentMethod, notes: notes || undefined,
  }).catch(() => {});

  return new Response(JSON.stringify({ reference }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
};
