// The ONE place that turns "this verified person wants into this free
// course" into an `enrollments` row.
//
// Before this file existed there were two hand-written copies of that logic:
// one in /api/auth/google/callback (sign in + enroll in one round trip) and
// one in /api/courses/enroll (the "Enroll now" button for someone who is
// already signed in). They had drifted apart -- different cap handling,
// different name handling, and only one of them had ever been exercised in
// production. Both now call enrollInFreeCourse(), so they cannot disagree.
//
// Rules this keeps identical to the old behaviour:
//   - free courses only; paid courses still enroll via /api/courses/pay
//     ('pending' until an admin approves the payment proof)
//   - never modifies or downgrades an existing enrollment row
//   - free-course concurrency cap (FREE_COURSE_CAP) applies to NEW enrollments
//   - rows are created status='active', same as before

import { getCourseBySlug } from './courses';
import { isAtFreeCourseCap, freeCourseCapMessage } from './enrollmentCap';
import { getClientName } from './clientAuth';

export type EnrollOutcome =
  | 'enrolled'    // new active enrollment created, or an unenrolled row reactivated
  | 'already'     // already actively enrolled -- nothing to do
  | 'cap'         // at the free-course in-progress limit
  | 'paid'        // course is paid -- must go through payment
  | 'not_found'   // no such course, or it's a draft
  | 'completed'   // already completed this course -- can't redo it
  | 'not_active'; // a non-active (pending/declined) row already exists -- left untouched

export type EnrollResult = { outcome: EnrollOutcome; courseTitle?: string };

// Codes are what travel in `?enrollError=` on the course page and what the
// JSON API returns as `code`.
export type EnrollErrorCode = 'cap' | 'paid' | 'not_found' | 'not_active' | 'completed' | 'name' | 'failed';

export const ENROLL_ERROR_MESSAGES: Record<EnrollErrorCode, string> = {
  cap: freeCourseCapMessage(),
  paid: 'This course requires payment first \u2014 use the payment form on the course page.',
  not_found: 'That course could not be found.',
  not_active: 'Your enrollment in this course is waiting on review, so it can\u2019t be started again here.',
  completed: 'You\u2019ve already completed this course, so it can\u2019t be started again.',
  name: 'Please enter your full name \u2014 it\u2019s what will appear on your certificate.',
  failed: 'Something went wrong while enrolling. Please try again.',
};

export function isEnrollErrorCode(value: string | null | undefined): value is EnrollErrorCode {
  return !!value && Object.prototype.hasOwnProperty.call(ENROLL_ERROR_MESSAGES, value);
}

export function cleanName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}

export async function enrollInFreeCourse(
  env: any,
  opts: { courseSlug: string; email: string; name: string }
): Promise<EnrollResult> {
  const course = await getCourseBySlug(env, opts.courseSlug);
  if (!course || course.data.draft) return { outcome: 'not_found' };
  if (course.data.isPaid) return { outcome: 'paid' };

  const email = opts.email.trim().toLowerCase();

  const existing = await env.DB.prepare(
    `SELECT status FROM enrollments WHERE course_slug = ? AND email = ?`
  ).bind(course.id, email).first<{ status: string }>();
  if (existing) {
    if (existing.status === 'active') return { outcome: 'already', courseTitle: course.data.title };

    if (existing.status === 'unenrolled') {
      // Re-enrolling in a course the learner previously dropped: reactivate
      // the same row (lesson progress and past quiz attempts are still
      // there) instead of inserting a duplicate. A completed course can
      // never legitimately reach 'unenrolled' -- /api/courses/unenroll
      // blocks that -- but this guard stays defensive.
      const cert = await env.DB.prepare(
        `SELECT 1 FROM certificates WHERE course_slug = ? AND email = ?`
      ).bind(course.id, email).first();
      if (cert) return { outcome: 'completed', courseTitle: course.data.title };

      if (await isAtFreeCourseCap(env, email)) return { outcome: 'cap', courseTitle: course.data.title };

      await env.DB.prepare(
        `UPDATE enrollments SET status = 'active', name = ?, enrolled_at = ?, unenrolled_at = NULL
         WHERE course_slug = ? AND email = ?`
      ).bind(opts.name, new Date().toISOString(), course.id, email).run();
      return { outcome: 'enrolled', courseTitle: course.data.title };
    }

    return { outcome: 'not_active', courseTitle: course.data.title };
  }

  if (await isAtFreeCourseCap(env, email)) return { outcome: 'cap', courseTitle: course.data.title };

  // ON CONFLICT covers the double-click / two-tabs race: whichever request
  // lands second is a harmless no-op instead of an error.
  await env.DB.prepare(
    `INSERT INTO enrollments (course_slug, course_title, name, email, enrolled_at, status)
     VALUES (?, ?, ?, ?, ?, 'active')
     ON CONFLICT(course_slug, email) DO NOTHING`
  ).bind(course.id, course.data.title, opts.name, email, new Date().toISOString()).run();

  return { outcome: 'enrolled', courseTitle: course.data.title };
}

// The name a certificate will carry. A person who is signed in but has never
// enrolled has no name on file yet, so we look in two places:
//   1. a name from any earlier enrollment (typed by them on the payment form,
//      or taken from Google) -- ignoring rows where the name is just their
//      email address, which an older version of the Enroll button produced
//   2. the signed cookie set at Google sign-in
// If neither has one, returns null and the page asks for it.
export async function resolveLearnerName(env: any, cookieHeader: string | null, email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  try {
    if (env?.DB) {
      const { results } = await env.DB.prepare(
        `SELECT name FROM enrollments WHERE email = ? ORDER BY enrolled_at DESC LIMIT 10`
      ).bind(normalized).all<{ name: string }>();
      for (const row of results || []) {
        const n = cleanName(row.name);
        if (n && n.toLowerCase() !== normalized && !n.includes('@')) return n;
      }
    }
  } catch (err) {
    console.error('[enrollment] name lookup failed', err);
  }
  if (env?.CLIENT_SESSION_SECRET) {
    const fromCookie = await getClientName(cookieHeader, env.CLIENT_SESSION_SECRET, normalized);
    if (fromCookie) return fromCookie;
  }
  return null;
}
