import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getSession } from '../../../lib/adminAuth';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const { results } = await env.DB.prepare(
    `SELECT e.id, e.course_slug, e.course_title, e.name, e.email, e.enrolled_at,
            (SELECT COUNT(*) FROM certificates c WHERE c.course_slug = e.course_slug AND c.email = e.email) as completed
     FROM enrollments e ORDER BY e.enrolled_at DESC LIMIT 1000`
  ).all();

  return new Response(JSON.stringify({ enrollments: results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id)) return new Response(JSON.stringify({ error: 'Missing id.' }), { status: 400 });

  // Deleting an enrollment record only -- any certificate the learner
  // already earned lives in its own table and is untouched here.
  await env.DB.prepare(`DELETE FROM enrollments WHERE id = ?`).bind(id).run();
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
