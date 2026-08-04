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

  const { results: certificates } = await env.DB.prepare(
    `SELECT id, course_slug, course_title, ce_hours, name, email, score_percent, issued_at
     FROM certificates ORDER BY issued_at DESC LIMIT 2000`
  ).all();

  // Per-course performance: how many have enrolled, attempted, passed, and
  // been issued a certificate for each course — so it's clear which courses
  // are converting well and which aren't.
  const { results: courseStats } = await env.DB.prepare(
    `SELECT
       e.course_slug,
       e.course_title,
       COUNT(DISTINCT e.email) as enrolled_count,
       (SELECT COUNT(*) FROM course_attempts a WHERE a.course_slug = e.course_slug) as attempt_count,
       (SELECT COUNT(*) FROM course_attempts a WHERE a.course_slug = e.course_slug AND a.passed = 1) as passed_attempt_count,
       (SELECT COUNT(*) FROM certificates c WHERE c.course_slug = e.course_slug) as certificate_count,
       (SELECT ROUND(AVG(a.score_percent)) FROM course_attempts a WHERE a.course_slug = e.course_slug) as avg_score_percent
     FROM enrollments e
     GROUP BY e.course_slug, e.course_title
     ORDER BY certificate_count DESC`
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
