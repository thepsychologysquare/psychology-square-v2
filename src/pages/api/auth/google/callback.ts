import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifyOAuthState, exchangeCodeForProfile } from '../../../../lib/googleAuth';
import { createClientSessionCookie } from '../../../../lib/clientAuth';
import { isAtFreeCourseCap } from '../../../../lib/enrollmentCap';

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

  // If this sign-in was to enroll in a course, create the enrollment now --
  // Google has just proven they own this email address. Paid courses are
  // the exception: enrollment there is created by the payment-proof
  // submission (/api/courses/pay) instead, starting out 'pending' until
  // reviewed -- signing in alone should never unlock a paid course's lessons.
  let justEnrolled = false;
  let enrollCapReached = false;
  if (state.enrollCourseSlug) {
    const { getCourseBySlug } = await import('../../../../lib/courses');
    const course = await getCourseBySlug(env, state.enrollCourseSlug);
    if (course && !course.data.isPaid) {
      if (await isAtFreeCourseCap(env, profile.email)) {
        enrollCapReached = true;
      } else {
        await env.DB.prepare(
          `INSERT INTO enrollments (course_slug, course_title, name, email, enrolled_at, status)
           VALUES (?, ?, ?, ?, ?, 'active')
           ON CONFLICT(course_slug, email) DO NOTHING`
        ).bind(
          state.enrollCourseSlug,
          course.data.title,
          profile.name,
          profile.email,
          new Date().toISOString()
        ).run();
        justEnrolled = true;
      }
    }
  }

  const cookie = await createClientSessionCookie(env.CLIENT_SESSION_SECRET, profile.email, new URL(request.url).protocol === 'https:');
  const redirectUrl = new URL(state.redirectPath || '/my-certificates', request.url);
  // Tell the destination page whether an enrollment just happened as part
  // of this sign-in round trip, so it can show the enroll-confirmation
  // modal (or the cap-reached message) without another round trip.
  if (justEnrolled) redirectUrl.searchParams.set('justEnrolled', '1');
  if (enrollCapReached) redirectUrl.searchParams.set('enrollCap', '1');

  return new Response(null, {
    status: 302,
    headers: { location: redirectUrl.toString(), 'set-cookie': cookie },
  });
};
