import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { consumeMagicLinkToken } from '../../../lib/magicLink';
import { createClientSessionCookie } from '../../../lib/clientAuth';

export const prerender = false;

export const GET: APIRoute = async ({ request, redirect }) => {
  if (!env?.SESSION || !env?.CLIENT_SESSION_SECRET) {
    return new Response('Certificate lookup is not configured yet.', { status: 500 });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';

  const email = await consumeMagicLinkToken(env.SESSION, token);
  if (!email) {
    return redirect('/my-certificates?expired=1', 302);
  }

  const cookie = await createClientSessionCookie(env.CLIENT_SESSION_SECRET, email);
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/my-certificates',
      'set-cookie': cookie,
    },
  });
};
