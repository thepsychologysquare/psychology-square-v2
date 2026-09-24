import type { APIRoute } from 'astro';
import { clearClientSessionCookie, clearClientNameCookie } from '../../../lib/clientAuth';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const secure = new URL(request.url).protocol === 'https:';
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.append('set-cookie', clearClientSessionCookie(secure));
  headers.append('set-cookie', clearClientNameCookie(secure));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};
