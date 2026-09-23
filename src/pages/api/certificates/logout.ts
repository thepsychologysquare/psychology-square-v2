import type { APIRoute } from 'astro';
import { clearClientSessionCookie } from '../../../lib/clientAuth';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const secure = new URL(request.url).protocol === 'https:';
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': clearClientSessionCookie(secure) },
  });
};
