export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getSession } from '../../../lib/adminAuth';
import { listCourseCategories, addCourseCategory } from '../../../lib/courseCategories';

async function requireAdmin(request: Request) {
  return getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
}

export const GET: APIRoute = async ({ request }) => {
  if (!(await requireAdmin(request))) return new Response('Unauthorized', { status: 401 });
  const categories = await listCourseCategories(env);
  return new Response(JSON.stringify({ categories }), { status: 200, headers: { 'content-type': 'application/json' } });
};

export const POST: APIRoute = async ({ request }) => {
  if (!(await requireAdmin(request))) return new Response('Unauthorized', { status: 401 });
  const body = await request.json().catch(() => null);
  const label = typeof body?.label === 'string' ? body.label : '';

  try {
    const category = await addCourseCategory(env, label);
    return new Response(JSON.stringify({ category }), { status: 201, headers: { 'content-type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Could not add that topic.' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
};
