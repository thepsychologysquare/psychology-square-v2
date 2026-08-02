import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getCollection } from 'astro:content';
import { getClientSession } from '../../../lib/clientAuth';
import { sendCoursePaymentReceivedEmail, sendNewCoursePaymentAdminEmail } from '../../../lib/email';

export const prerender = false;

const PAYMENT_METHODS = new Set(['jazzcash', 'bank_hbl', 'bank_ubl']);
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5MB — same limit as booking screenshots

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Paid-course access gate: learner has already signed in via magic link
// (proving they own the email), then submits payment proof here. This
// creates (or re-submits) a 'pending' enrollment row -- lessons stay
// locked until an admin/clinician confirms it from the dashboard.
export const POST: APIRoute = async ({ request }) => {
  if (!env?.DB || !env?.SCREENSHOTS || !env?.CLIENT_SESSION_SECRET) {
    return jsonError('Payment submission is not configured yet.', 500);
  }

  const session = await getClientSession(request.headers.get('cookie'), env.CLIENT_SESSION_SECRET);
  if (!session) {
    return jsonError('Please sign in first.', 401);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError('Could not read the submitted form.', 400);
  }

  const courseSlug = String(formData.get('course_slug') || '').trim();
  const name = String(formData.get('name') || '').trim();
  const paymentMethod = String(formData.get('payment_method') || '');
  const screenshot = formData.get('screenshot');

  if (!courseSlug) return jsonError('Missing course.', 400);
  if (!name || name.length > 200) return jsonError('Please enter your name.', 400);
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

  const courses = await getCollection('courses', ({ data }) => !data.draft);
  const course = courses.find((c) => c.id === courseSlug);
  if (!course) return jsonError('Course not found.', 404);
  if (!course.data.isPaid) return jsonError('This course does not require payment.', 400);

  // Already-active enrollments (already confirmed) shouldn't be able to
  // resubmit and reset themselves back to pending.
  const existing = await env.DB.prepare(
    `SELECT status FROM enrollments WHERE course_slug = ? AND email = ?`
  ).bind(courseSlug, session.email).first<{ status: string }>();
  if (existing?.status === 'active') {
    return jsonError('You already have access to this course.', 400);
  }

  const amountPkr = course.data.pricePkr ?? 0;
  const extension = screenshot.type.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'jpg';
  const screenshotKey = `course-${courseSlug}-${crypto.randomUUID()}.${extension}`;

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
      `INSERT INTO enrollments
        (course_slug, course_title, name, email, enrolled_at, status, amount_pkr, payment_method, screenshot_key, screenshot_type, payment_submitted_at, reviewed_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(course_slug, email) DO UPDATE SET
         name = excluded.name,
         status = 'pending',
         amount_pkr = excluded.amount_pkr,
         payment_method = excluded.payment_method,
         screenshot_key = excluded.screenshot_key,
         screenshot_type = excluded.screenshot_type,
         payment_submitted_at = excluded.payment_submitted_at,
         reviewed_at = NULL`
    ).bind(
      courseSlug, course.data.title, name, session.email, now,
      amountPkr, paymentMethod, screenshotKey, screenshot.type, now
    ).run();
  } catch {
    await env.SCREENSHOTS.delete(screenshotKey).catch(() => {});
    return jsonError('Could not save your enrollment. Please try again.', 500);
  }

  // Best-effort — a failed notification email should never block the
  // submission itself, which is already saved and visible on the dashboard.
  await sendCoursePaymentReceivedEmail(env, {
    toEmail: session.email,
    toName: name,
    courseTitle: course.data.title,
  }).catch(() => {});

  await sendNewCoursePaymentAdminEmail(env, {
    learnerName: name,
    learnerEmail: session.email,
    courseTitle: course.data.title,
    amountPkr,
    paymentMethod,
  }).catch(() => {});

  return new Response(JSON.stringify({ ok: true }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
};
