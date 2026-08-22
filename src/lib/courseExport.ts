// Whenever a course (or one of its modules/steps) is created, edited, or
// deleted from the Studio, we snapshot the *entire* course — metadata,
// modules, steps, questions, quiz, everything — into a single JSON file.
//
// Two destinations, deliberately asymmetric:
//   - R2 (COURSE_ASSETS bucket): always attempted, always safe. The bucket
//     is already bound in wrangler.jsonc, so this needs zero setup and can
//     never fail in a way that blocks a course save.
//   - GitHub (same repo Decap commits articles/worksheets to): only
//     attempted if GITHUB_COURSE_EXPORT_TOKEN is configured as a Worker
//     secret. If it's missing, or the GitHub API call fails for any
//     reason, we log it and move on — this NEVER throws, and NEVER
//     prevents the course itself from saving.
//
// D1 remains the only source of truth the site actually renders from.
// These exports are a read-only mirror for your own records/version
// history — nothing here is read back by the site.

import { getCourseBySlug } from './courses';
import { getCourseOutline } from './courseBuilder';

const GITHUB_REPO = 'thepsychologysquare/psychology-square-v2';
const GITHUB_BRANCH = 'main';
const GITHUB_EXPORT_DIR = 'src/content/course-exports';
const R2_EXPORT_PREFIX = 'exports';

export async function buildCourseExport(env: any, slug: string): Promise<Record<string, any> | null> {
  const course = await getCourseBySlug(env, slug);
  if (!course) return null;

  const outline = env?.DB ? await getCourseOutline(env.DB, slug) : [];

  return {
    exportedAt: new Date().toISOString(),
    slug,
    course: {
      title: course.data.title,
      description: course.data.description,
      category: course.data.category,
      estimatedHours: course.data.estimatedHours,
      author: course.data.author,
      isPaid: course.data.isPaid,
      pricePkr: course.data.pricePkr ?? null,
      passScorePercent: course.data.passScorePercent,
      image: course.data.image ?? null,
      imageAlt: course.data.imageAlt ?? null,
      order: course.data.order,
      draft: course.data.draft,
      quiz: course.data.quiz,
    },
    modules: outline.map((m) => ({
      title: m.title,
      order: m.sequence_order,
      steps: m.steps.map((s) => ({
        title: s.title,
        type: s.content_type,
        content: s.content_body,
        videoUrl: s.video_url,
        order: s.sequence_order,
        question: s.question
          ? {
              question: s.question,
              options: JSON.parse(s.question_options || '[]'),
              correctIndex: s.question_correct_index,
            }
          : null,
      })),
    })),
  };
}

function toBase64Utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function exportToR2(env: any, slug: string): Promise<void> {
  try {
    if (!env?.COURSE_ASSETS) return;
    const data = await buildCourseExport(env, slug);
    if (!data) return;
    await env.COURSE_ASSETS.put(`${R2_EXPORT_PREFIX}/${slug}.json`, JSON.stringify(data, null, 2), {
      httpMetadata: { contentType: 'application/json' },
    });
  } catch (err) {
    console.error('[courseExport] R2 export failed for', slug, err);
  }
}

async function deleteFromR2(env: any, slug: string): Promise<void> {
  try {
    if (!env?.COURSE_ASSETS) return;
    await env.COURSE_ASSETS.delete(`${R2_EXPORT_PREFIX}/${slug}.json`);
  } catch (err) {
    console.error('[courseExport] R2 delete failed for', slug, err);
  }
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'psychology-square-course-export',
    Accept: 'application/vnd.github+json',
  };
}

async function exportToGitHub(env: any, slug: string): Promise<void> {
  const token = env?.GITHUB_COURSE_EXPORT_TOKEN;
  if (!token) return; // Not configured -- R2 export still happened, this is optional.
  try {
    const data = await buildCourseExport(env, slug);
    if (!data) return;

    const path = `${GITHUB_EXPORT_DIR}/${slug}.json`;
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
    const headers = githubHeaders(token);

    let sha: string | undefined;
    const existing = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { headers });
    if (existing.ok) {
      const json = (await existing.json()) as { sha: string };
      sha = json.sha;
    }

    await fetch(apiUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Course export: ${slug}`,
        content: toBase64Utf8(JSON.stringify(data, null, 2)),
        branch: GITHUB_BRANCH,
        sha,
      }),
    });
  } catch (err) {
    console.error('[courseExport] GitHub export failed for', slug, err);
  }
}

async function deleteFromGitHub(env: any, slug: string): Promise<void> {
  const token = env?.GITHUB_COURSE_EXPORT_TOKEN;
  if (!token) return;
  try {
    const path = `${GITHUB_EXPORT_DIR}/${slug}.json`;
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
    const headers = githubHeaders(token);

    const existing = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { headers });
    if (!existing.ok) return;
    const json = (await existing.json()) as { sha: string };

    await fetch(apiUrl, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Remove course export: ${slug}`, sha: json.sha, branch: GITHUB_BRANCH }),
    });
  } catch (err) {
    console.error('[courseExport] GitHub delete failed for', slug, err);
  }
}

/** Call after any create/update to a course, module, or step. Never throws. */
export async function syncCourseExport(env: any, slug: string): Promise<void> {
  await Promise.allSettled([exportToR2(env, slug), exportToGitHub(env, slug)]);
}

/** Call after a course is fully deleted. Never throws. */
export async function removeCourseExport(env: any, slug: string): Promise<void> {
  await Promise.allSettled([deleteFromR2(env, slug), deleteFromGitHub(env, slug)]);
}
