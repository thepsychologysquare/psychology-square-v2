import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getSession } from '../../../lib/adminAuth';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const { results } = await env.DB.prepare(
    `SELECT id, course_slug, course_title, step_id, step_title, name, email, question, answer, status, created_at, answered_at
     FROM course_questions ORDER BY created_at DESC LIMIT 500`
  ).all();

  return new Response(JSON.stringify({ questions: results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

// PATCH { id, answer, status: 'published' } to answer + publish,
// or { id, status: 'declined' } to decline without publishing.
export const PATCH: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  const status = body?.status;
  const answer = typeof body?.answer === 'string' ? body.answer.trim() : '';

  if (!id || !['published', 'declined'].includes(status)) {
    return new Response(JSON.stringify({ error: 'Invalid request.' }), { status: 400 });
  }
  if (status === 'published' && !answer) {
    return new Response(JSON.stringify({ error: 'Please write an answer before publishing.' }), { status: 400 });
  }

  const result = await env.DB.prepare(
    `UPDATE course_questions SET status = ?, answer = ?, answered_at = ? WHERE id = ?`
  ).bind(status, status === 'published' ? answer : null, new Date().toISOString(), id).run();

  if (!result.meta?.changes) {
    return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'Missing id.' }), { status: 400 });

  await env.DB.prepare(`DELETE FROM course_questions WHERE id = ?`).bind(id).run();
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
