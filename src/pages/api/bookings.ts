import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

const SERVICES: Record<string, number> = { individual: 5000, couples: 7000, group: 10000 };
const PAYMENT_METHODS = new Set(['jazzcash', 'bank_hbl', 'bank_ubl']);
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5MB — typical screenshots are well under 1-2MB; this leaves comfortable headroom for high-DPI screens without allowing arbitrary large uploads
const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_SUBMISSIONS = 4;

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
  return `TPS-${code}`;
}

export const POST: APIRoute = async ({ request }) => {
  if (!env?.DB || !env?.SCREENSHOTS) {
    return jsonError('Booking system is not configured yet.', 500);
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';

  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
  const recentCount = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM bookings WHERE submitter_ip = ? AND created_at > ?`
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

  const clientName = String(formData.get('client_name') || '').trim();
  const contact = String(formData.get('contact') || '').trim();
  const service = String(formData.get('service') || '');
  const notes = String(formData.get('notes') || '').trim();
  const paymentMethod = String(formData.get('payment_method') || '');
  const slotId = Number(formData.get('slot_id'));
  const screenshot = formData.get('screenshot');

  if (!clientName || clientName.length > 200) return jsonError('Please enter your name.', 400);
  if (!contact || contact.length > 200) return jsonError('Please enter an email or phone number.', 400);
  if (!(service in SERVICES)) return jsonError('Please choose a valid service.', 400);
  if (notes.length > 1000) return jsonError('Notes are too long.', 400);
  if (!PAYMENT_METHODS.has(paymentMethod)) return jsonError('Please choose a valid payment method.', 400);
  if (!Number.isInteger(slotId) || slotId <= 0) return jsonError('Please pick an available time slot.', 400);

  if (!(screenshot instanceof File) || screenshot.size === 0) {
    return jsonError('Please attach a screenshot of your payment.', 400);
  }
  if (screenshot.size > MAX_SCREENSHOT_BYTES) {
    return jsonError('That screenshot is too large — please attach one under 5MB.', 400);
  }
  if (!screenshot.type.startsWith('image/')) {
    return jsonError('Please attach an image file.', 400);
  }

  // Atomically claim the slot: only succeeds if it's still 'open'.
  const claim = await env.DB.prepare(
    `UPDATE availability_slots SET status = 'booked' WHERE id = ? AND status = 'open'`
  ).bind(slotId).run();
  if (!claim.meta.changes) {
    return jsonError('Sorry, that time slot was just taken. Please pick another.', 409);
  }

  const slot = await env.DB.prepare(
    `SELECT clinician, date, time FROM availability_slots WHERE id = ?`
  ).bind(slotId).first<{ clinician: string; date: string; time: string }>();

  const reference = makeReference();
  const extension = screenshot.type.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'jpg';
  const screenshotKey = `${reference}.${extension}`;

  try {
    await env.SCREENSHOTS.put(screenshotKey, await screenshot.arrayBuffer(), {
      httpMetadata: { contentType: screenshot.type },
    });
  } catch {
    await env.DB.prepare(`UPDATE availability_slots SET status = 'open' WHERE id = ?`).bind(slotId).run();
    return jsonError('Could not save your screenshot. Please try again.', 500);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO bookings
        (id, created_at, client_name, contact, service, clinician, preferred_time, notes,
         amount_pkr, payment_method, screenshot_key, screenshot_type, status, submitter_ip, slot_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).bind(
      reference,
      new Date().toISOString(),
      clientName,
      contact,
      service,
      slot!.clinician,
      `${slot!.date} ${slot!.time}`,
      notes || null,
      SERVICES[service],
      paymentMethod,
      screenshotKey,
      screenshot.type,
      ip,
      slotId
    ).run();
  } catch {
    await env.SCREENSHOTS.delete(screenshotKey).catch(() => {});
    await env.DB.prepare(`UPDATE availability_slots SET status = 'open' WHERE id = ?`).bind(slotId).run();
    return jsonError('Could not save your booking. Please try again.', 500);
  }

  return new Response(JSON.stringify({ reference }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
};
