import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getClientSession } from '../../../lib/clientAuth';
import {
  enrollInFreeCourse,
  resolveLearnerName,
  cleanName,
  ENROLL_ERROR_MESSAGES,
  type EnrollErrorCode,
} from '../../../lib/enrollment';

export const prerender = false;

// One endpoint, two callers:
//   - The "Enroll now" <form method="post"> on the course page. It works with
//     no JavaScript at all: we enroll and 303 back to the course page.
//   - JSON callers (a stale cached copy of the old course page still posts
//     JSON and reads {ok} / {error}) -- that contract is preserved.

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function see(request: Request, path: string) {
  return new Response(null, { status: 303, headers: { location: new URL(path, request.url).toString() } });
}

const coursePath = (slug: string, code?: EnrollErrorCode) =>
  `/courses/${encodeURIComponent(slug)}/${code ? `?enrollError=${code}` : ''}`;

export const POST: APIRoute = async ({ request }) => {
  const isJson = (request.headers.get('content-type') || '').includes('application/json');

  const fail = (slug: string, code: EnrollErrorCode, status: number) =>
    isJson ? json({ error: ENROLL_ERROR_MESSAGES[code], code }, status) : see(request, slug ? coursePath(slug, code) : '/courses/');

  if (!env?.DB || !env?.CLIENT_SESSION_SECRET) {
    return isJson ? json({ error: 'Enrollment is not configured yet.' }, 500) : see(request, '/courses/');
  }

  // Cross-site form posts are already blocked by SameSite=Lax on the session
  // cookie; this is a second, explicit guard.
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return json({ error: 'Cross-site request blocked.' }, 403);
  }

  let courseSlug = '';
  let providedName = '';
  if (isJson) {
    const body = await request.json().catch(() => null);
    courseSlug = typeof body?.courseSlug === 'string' ? body.courseSlug : '';
    providedName = cleanName(body?.name);
  } else {
    const form = await request.formData().catch(() => null);
    courseSlug = typeof form?.get('courseSlug') === 'string' ? (form!.get('courseSlug') as string) : '';
    providedName = cleanName(form?.get('name'));
  }
  if (!courseSlug) {
    return isJson ? json({ error: 'Missing course.' }, 400) : see(request, '/courses/');
  }

  const session = await getClientSession(request.headers.get('cookie'), env.CLIENT_SESSION_SECRET);
  if (!session) {
    return isJson
      ? json({ error: 'Please sign in first.' }, 401)
      : see(request, `/login?redirect=${encodeURIComponent(coursePath(courseSlug))}`);
  }

  const name = providedName || (await resolveLearnerName(env, request.headers.get('cookie'), session.email));
  if (!name) return fail(courseSlug, 'name', 400);

  let result;
  try {
    result = await enrollInFreeCourse(env, { courseSlug, email: session.email, name });
  } catch (err) {
    console.error('[enroll] failed', err);
    return fail(courseSlug, 'failed', 500);
  }

  switch (result.outcome) {
    case 'enrolled':
    case 'already':
      return isJson ? json({ ok: true }, 200) : see(request, coursePath(courseSlug));
    case 'cap':
      return fail(courseSlug, 'cap', 400);
    case 'paid':
      return fail(courseSlug, 'paid', 400);
    case 'not_active':
      return fail(courseSlug, 'not_active', 409);
    default:
      return fail(courseSlug, 'not_found', 404);
  }
};
