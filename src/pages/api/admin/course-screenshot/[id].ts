import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getSession } from '../../../../lib/adminAuth';

export const prerender = false;

export const GET: APIRoute = async ({ request, params }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response('Not signed in.', { status: 401 });

  const id = params.id;
  const record = await env.DB.prepare(
    `SELECT screenshot_key, screenshot_type FROM enrollments WHERE id = ? AND amount_pkr IS NOT NULL`
  ).bind(id).first<{ screenshot_key: string | null; screenshot_type: string | null }>();

  if (!record || !record.screenshot_key) return new Response('Not found.', { status: 404 });

  const object = await env.SCREENSHOTS.get(record.screenshot_key);
  if (!object) return new Response('Not found.', { status: 404 });

  return new Response(object.body, {
    status: 200,
    headers: { 'content-type': record.screenshot_type || 'application/octet-stream', 'cache-control': 'private, max-age=3600' },
  });
};
