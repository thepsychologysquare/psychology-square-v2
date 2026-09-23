import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createOAuthState, googleAuthorizationUrl } from '../../../../lib/googleAuth';

export const prerender = false;

// GET (not POST) because this only ever redirects the browser to Google --
// it's meant to be used as a plain link/button href, same as any other
// "go here to continue" navigation.
export const GET: APIRoute = async ({ url, request }) => {
  if (!env?.GOOGLE_CLIENT_ID || !env?.CLIENT_SESSION_SECRET) {
    return new Response('Sign-in is not configured yet.', { status: 500 });
  }

  const redirectParam = url.searchParams.get('redirect');
  const redirectPath = redirectParam && redirectParam.startsWith('/') ? redirectParam : undefined;
  const enrollCourseSlug = url.searchParams.get('enroll') || undefined;

  const state = await createOAuthState(env.CLIENT_SESSION_SECRET, { redirectPath, enrollCourseSlug });
  const redirectUri = new URL('/api/auth/google/callback', request.url).toString();
  const authUrl = googleAuthorizationUrl({ clientId: env.GOOGLE_CLIENT_ID, redirectUri, state });

  return Response.redirect(authUrl, 302);
};
