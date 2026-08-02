export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getClientSession } from '../../../lib/clientAuth';

export const POST: APIRoute = async ({ request }) => {
  if (!env?.DB || !env?.CLIENT_SESSION_SECRET) return new Response('Not configured', { status: 500 });

  const session = await getClientSession(request.headers.get('cookie'), env.CLIENT_SESSION_SECRET);
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401 });

  const { courseSlug, stepId } = await request.json();
  if (!courseSlug || !stepId) return new Response(JSON.stringify({ error: 'courseSlug and stepId are required' }), { status: 400 });

  const enrollment = await env.DB.prepare(
    `SELECT 1 FROM enrollments WHERE course_slug = ? AND email = ?`
  ).bind(courseSlug, session.email).first();
  if (!enrollment) return new Response(JSON.stringify({ error: 'Not enrolled' }), { status: 403 });

  await env.DB.prepare(
    `INSERT INTO step_completions (email, step_id, course_slug, completed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (email, step_id) DO NOTHING`
  ).bind(session.email.trim().toLowerCase(), stepId, courseSlug, new Date().toISOString()).run();

  return new Response(JSON.stringify({ ok: true }));
};
