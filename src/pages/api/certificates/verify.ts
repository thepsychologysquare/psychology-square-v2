import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { consumeMagicLinkToken } from '../../../lib/magicLink';
import { createClientSessionCookie } from '../../../lib/clientAuth';

export const prerender = false;

export const GET: APIRoute = async ({ request, redirect }) => {
  if (!env?.DB || !env?.CLIENT_SESSION_SECRET) {
    return new Response('Sign-in is not configured yet.', { status: 500 });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';

  const payload = await consumeMagicLinkToken(env.DB, token);
  if (!payload) {
    return redirect('/my-certificates?expired=1', 302);
  }

  // If this login was to enroll in a course, create the enrollment now —
  // the person has just proven they own this email address.
  if (payload.enrollCourseSlug && payload.enrollName) {
    const { getCollection } = await import('astro:content');
    const courses = await getCollection('courses');
    const course = courses.find((c) => c.id === payload.enrollCourseSlug);
    await env.DB.prepare(
      `INSERT INTO enrollments (course_slug, course_title, name, email, enrolled_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(course_slug, email) DO NOTHING`
    ).bind(
      payload.enrollCourseSlug,
      course?.data.title || payload.enrollCourseSlug,
      payload.enrollName,
      payload.email,
      new Date().toISOString()
    ).run();
  }

  const cookie = await createClientSessionCookie(env.CLIENT_SESSION_SECRET, payload.email);
  return new Response(null, {
    status: 302,
    headers: {
      'Location': payload.redirectPath || '/my-certificates',
      'set-cookie': cookie,
    },
  });
};
