import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getSession } from '../../../lib/adminAuth';

export const prerender = false;

// Full certificate record + per-course performance, for the admin dashboard.
// Certificates are earned site-wide (not per-clinician), so unlike bookings
// this isn't filtered by role — any signed-in staff member can see it all.
export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  // Each certificate joined back to its matching enrollment (same course +
  // learner email) purely to read what that learner actually paid — the
  // real transaction amount, not just the course's current listed price,
  // since prices can change after someone already paid an older one.
  const { results: certificates } = await env.DB.prepare(
    `SELECT
       cert.id, cert.course_slug, cert.course_title, cert.ce_hours, cert.name, cert.email,
       cert.score_percent, cert.issued_at,
       e.amount_pkr as amount_pkr, e.payment_method as payment_method
     FROM certificates cert
     LEFT JOIN enrollments e ON e.course_slug = cert.course_slug AND e.email = cert.email
     ORDER BY cert.issued_at DESC LIMIT 2000`
  ).all();

  // Per-course performance, driven from the courses catalog itself (not
  // from enrollments) so a brand-new course with zero activity still shows
  // up as a real zero row instead of silently not appearing at all — that
  // matters once there are hundreds of courses and you want a true picture
  // of the whole catalog, not just the ones someone has touched.
  //
  // Funnel is counted by distinct learner (email), not by raw row/attempt
  // count, so "Started quiz" and "Passed" answer "how many people", which
  // is what the pass-rate calculation on the frontend expects as its
  // denominator/numerator.
  const { results: courseStats } = await env.DB.prepare(
    `SELECT
       c.slug as course_slug,
       c.title as course_title,
       c.category as category,
       COALESCE(cat.label, c.category) as category_label,
       c.is_paid as is_paid,
       c.price_pkr as price_pkr,
       c.draft as draft,
       (SELECT COUNT(DISTINCT e.email) FROM enrollments e WHERE e.course_slug = c.slug AND e.status = 'active') as enrolled_count,
       (SELECT COUNT(DISTINCT e.email) FROM enrollments e WHERE e.course_slug = c.slug AND e.status = 'unenrolled') as dropped_count,
       (SELECT COUNT(DISTINCT a.email) FROM course_attempts a WHERE a.course_slug = c.slug) as started_quiz_count,
       (SELECT COUNT(DISTINCT a.email) FROM course_attempts a WHERE a.course_slug = c.slug AND a.passed = 1) as passed_count,
       (SELECT ROUND(AVG(a.score_percent)) FROM course_attempts a WHERE a.course_slug = c.slug) as avg_score_percent,
       (SELECT COUNT(*) FROM certificates cert WHERE cert.course_slug = c.slug) as certificate_count,
       (SELECT COALESCE(SUM(e.amount_pkr), 0) FROM enrollments e WHERE e.course_slug = c.slug AND e.status = 'active' AND e.amount_pkr IS NOT NULL) as revenue_pkr,
       (SELECT COUNT(*) FROM course_feedback f WHERE f.course_slug = c.slug) as feedback_count,
       (SELECT ROUND(AVG((f.clarity_rating + f.usefulness_rating + f.recommend_rating) / 3.0), 1)
          FROM course_feedback f WHERE f.course_slug = c.slug) as avg_satisfaction
     FROM courses c
     LEFT JOIN course_categories cat ON cat.value = c.category
     ORDER BY c.sort_order ASC, c.title ASC`
  ).all();

  return new Response(JSON.stringify({ certificates, courseStats }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'Missing id.' }), { status: 400 });

  await env.DB.prepare(`DELETE FROM certificates WHERE id = ?`).bind(id).run();
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
