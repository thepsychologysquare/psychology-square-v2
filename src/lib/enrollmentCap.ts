// Free-course concurrency cap.
//
// Learners can enroll in as many free courses as they like over time, but
// only FREE_COURSE_CAP of them can be "in progress" (enrolled + active,
// no certificate yet) at once. This keeps the always-open enrollment model
// from letting one email hoard dozens of unfinished free courses. Paid
// courses are never counted or capped here -- payment itself is the
// natural limiter for those.
//
// A course frees up a slot automatically the moment either becomes true:
//   - the learner passes the quiz (a `certificates` row appears), or
//   - the enrollment stops being 'active' (e.g. never applies to free
//     courses today, but kept generic on purpose).
// Both are just conditions on the same COUNT query below, so there's
// nothing to "release" manually.

import { getCourseBySlug } from './courses';

export const FREE_COURSE_CAP = 5;

export const freeCourseCapMessage = (count: number = FREE_COURSE_CAP) =>
  `You can only have ${count} free courses in progress at once, and you're already at that limit. Finish (or drop) one of your current free courses to free up a spot before enrolling in another.`;

// Every active enrollment for this email that doesn't have a matching
// certificate yet -- i.e. still "in progress". Includes paid courses too;
// the caller filters those out below since course pricing isn't stored on
// the enrollments row itself.
async function activeIncompleteEnrollmentSlugs(env: any, email: string): Promise<string[]> {
  if (!env?.DB) return [];
  const { results } = await env.DB.prepare(
    `SELECT e.course_slug AS courseSlug
     FROM enrollments e
     WHERE e.email = ? AND e.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM certificates c WHERE c.email = e.email AND c.course_slug = e.course_slug
       )`
  ).bind(email).all<{ courseSlug: string }>();
  return (results || []).map((r) => r.courseSlug);
}

// Counts only the free courses among those in-progress enrollments.
export async function countActiveIncompleteFreeEnrollments(env: any, email: string): Promise<number> {
  const slugs = await activeIncompleteEnrollmentSlugs(env, email);
  if (slugs.length === 0) return 0;

  let count = 0;
  for (const slug of slugs) {
    const course = await getCourseBySlug(env, slug);
    // If the course was since unpublished/removed, don't let a stale row
    // block someone forever -- just don't count it either way.
    if (course && !course.data.isPaid) count++;
  }
  return count;
}

export async function isAtFreeCourseCap(env: any, email: string): Promise<boolean> {
  return (await countActiveIncompleteFreeEnrollments(env, email)) >= FREE_COURSE_CAP;
}
