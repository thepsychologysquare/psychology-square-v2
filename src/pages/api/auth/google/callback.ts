import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifyOAuthState, exchangeCodeForProfile } from '../../../../lib/googleAuth';
import { createClientSessionCookie, createClientNameCookie } from '../../../../lib/clientAuth';
import { enrollInFreeCourse } from '../../../../lib/enrollment';
import { safeRedirectPath } from '../../../../lib/safeRedirect';

export const prerender = false;

function loginRedirect(request: Request, query: string) {
  return new Response(null, {
    status: 302,
    headers: { location: new URL(`/login?${query}`, request.url).toString() },
  });
}

export const GET: APIRoute = async ({ url, request }) => {
  if (!env?.DB || !env?.CLIENT_SESSION_SECRET || !env?.GOOGLE_CLIENT_ID || !env?.GOOGLE_CLIENT_SECRET) {
    return new Response('Sign-in is not configured yet.', { status: 500 });
  }

  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');

  // Google sends `error` instead of `code` if the person cancels/denies
  // access on the consent screen -- that's a normal outcome, not a bug.
  if (url.searchParams.get('error') || !code || !stateParam) {
    return loginRedirect(request, 'error=1');
  }

  const state = await verifyOAuthState(env.CLIENT_SESSION_SECRET, stateParam);
  if (!state) {
    return loginRedirect(request, 'expired=1');
  }

  const redirectUri = new URL('/api/auth/google/callback', request.url).toString();
  const profile = await exchangeCodeForProfile({
    code,
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri,
  });
  if (!profile) {
    return loginRedirect(request, 'error=1');
  }

  // Signing in and enrolling are separate concerns. The person is signed in
  // no matter what happens below -- if enrolling hits a problem, they still
  // land on the course page, signed in, and the "Enroll now" button there
  // (same shared code path) is one click away. Previously an exception here
  // meant a 500 and no session at all.
  //
  // Paid courses are never enrolled here: enrollInFreeCourse() reports 'paid'
  // and enrollment is created by the payment-proof submission instead.
  let enrollError: string | null = null;
  if (state.enrollCourseSlug) {
    try {
      const result = await enrollInFreeCourse(env, {
        courseSlug: state.enrollCourseSlug,
        email: profile.email,
        name: profile.name,
      });
      if (result.outcome === 'cap') enrollError = 'cap';
    } catch (err) {
      console.error('[google callback] enrollment failed; signing in anyway', err);
    }
  }

  const secure = new URL(request.url).protocol === 'https:';
  const redirectUrl = new URL(safeRedirectPath(state.redirectPath), request.url);
  if (enrollError) redirectUrl.searchParams.set('enrollError', enrollError);

  const headers = new Headers({ location: redirectUrl.toString() });
  headers.append('set-cookie', await createClientSessionCookie(env.CLIENT_SESSION_SECRET, profile.email, secure));
  // Remember the Google display name so a later one-click "Enroll now" (e.g.
  // after a plain /login) already knows what to print on the certificate.
  // Skipped when Google gave us nothing better than the email address.
  if (profile.name && profile.name.toLowerCase() !== profile.email) {
    headers.append('set-cookie', await createClientNameCookie(env.CLIENT_SESSION_SECRET, profile.email, profile.name, secure));
  }

  return new Response(null, { status: 302, headers });
};
