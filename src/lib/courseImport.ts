// Programmatic equivalent of building a course by hand in the Studio.
// One call in -> a full course row + all its modules + all their steps,
// written straight into D1 -- the exact same tables `/dashboard/courses`
// reads and writes. That's what makes the result live on the site AND
// still editable from the dashboard afterward: there is no separate data
// path for "automated" vs "hand-built" courses, it's the same rows.
//
// Contrast with the articles pipeline: there, the markdown file pushed to
// GitHub *is* the content the site renders. Here, GitHub/R2 are a mirror
// (see courseExport.ts) -- the write that matters is this one, into D1.
// syncCourseExport() is still called at the end so you get the same
// "there's a file for it" receipt you're used to from articles.

import { createCourse, getCourseBySlug, generateUniqueSlug, slugify, updateCourse } from './courses';
import { syncCourseExport } from './courseExport';

export interface CourseImportStep {
  title: string;
  type?: 'text' | 'video';
  content?: string; // lesson text/HTML for a 'text' step
  videoUrl?: string; // for a 'video' step
  question?: string; // optional ungraded check-in question
  questionOptions?: string[];
  questionCorrectIndex?: number;
}

export interface CourseImportModule {
  title: string;
  steps: CourseImportStep[];
}

export interface CourseImportPayload {
  slug?: string; // omit to always create a new course; provide to upsert an existing one
  title: string;
  description?: string;
  category?: string;
  estimatedHours?: number;
  author?: string;
  isPaid?: boolean;
  pricePkr?: number;
  passScorePercent?: number;
  image?: string; // any external URL is fine -- rendered as a plain <img src>
  imageAlt?: string;
  draft?: boolean; // defaults to true, same as the article pipeline's review step
  quiz: { question: string; options: string[]; correctIndex: number }[];
  modules: CourseImportModule[];
}

export interface CourseImportResult {
  slug: string;
  created: boolean;
}

export async function importCourse(env: any, payload: CourseImportPayload): Promise<CourseImportResult> {
  if (!env?.DB) throw new Error('Database unavailable');
  if (!payload?.title?.trim()) throw new Error('title is required');
  if (!Array.isArray(payload.modules) || payload.modules.length === 0) {
    throw new Error('modules is required and must contain at least one module');
  }

  const requestedSlug = payload.slug ? slugify(payload.slug) : null;
  const existing = requestedSlug ? await getCourseBySlug(env, requestedSlug) : null;
  const slug = existing ? requestedSlug! : requestedSlug || (await generateUniqueSlug(env, payload.title));

  const courseInput = {
    title: payload.title.trim(),
    description: payload.description || '',
    category: payload.category || 'general',
    estimatedHours: payload.estimatedHours ?? 1,
    author: payload.author || '',
    isPaid: !!payload.isPaid,
    pricePkr: payload.isPaid ? payload.pricePkr ?? 0 : null,
    passScorePercent: payload.passScorePercent ?? 80,
    image: payload.image ?? null,
    imageAlt: payload.imageAlt ?? null,
    draft: payload.draft !== false, // default true, same review-before-live posture as articles
  };

  if (existing) {
    await updateCourse(env, slug, { ...courseInput, quiz: payload.quiz || [] });
  } else {
    await createCourse(env, slug, courseInput);
    await updateCourse(env, slug, { quiz: payload.quiz || [] }); // createCourse always seeds quiz as '[]'
  }

  // Re-running an import for the same slug replaces its module/step tree
  // wholesale rather than trying to diff it -- simplest predictable
  // behavior for an automation to reason about. Note this does mean
  // re-importing an existing course clears per-step completions tied to
  // the old step ids (learners' progress on THAT run), since the steps
  // themselves are recreated with new ids. Fine for first publish; worth
  // knowing before you use this to "touch up" a course people are already
  // enrolled in.
  const oldModuleIds = (
    await env.DB.prepare(`SELECT id FROM course_modules WHERE course_slug = ?`).bind(slug).all()
  ).results as { id: string }[];
  if (oldModuleIds.length > 0) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM step_completions WHERE course_slug = ?`).bind(slug),
      ...oldModuleIds.map((m) => env.DB.prepare(`DELETE FROM course_steps WHERE module_id = ?`).bind(m.id)),
      env.DB.prepare(`DELETE FROM course_modules WHERE course_slug = ?`).bind(slug),
    ]);
  }

  const now = new Date().toISOString();
  const statements: any[] = [];
  payload.modules.forEach((mod, moduleIndex) => {
    const moduleId = crypto.randomUUID();
    statements.push(
      env.DB.prepare(
        `INSERT INTO course_modules (id, course_slug, title, sequence_order, created_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(moduleId, slug, mod.title, moduleIndex, now)
    );
    (mod.steps || []).forEach((step, stepIndex) => {
      statements.push(
        env.DB.prepare(
          `INSERT INTO course_steps
            (id, module_id, title, content_type, content_body, video_url, sequence_order, question, question_options, question_correct_index, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(),
          moduleId,
          step.title,
          step.type === 'video' ? 'video' : 'text',
          step.content || null,
          step.videoUrl || null,
          stepIndex,
          step.question || null,
          step.question ? JSON.stringify(step.questionOptions || []) : null,
          step.question ? step.questionCorrectIndex ?? 0 : null,
          now,
          now
        )
      );
    });
  });
  if (statements.length > 0) await env.DB.batch(statements);

  await syncCourseExport(env, slug);

  return { slug, created: !existing };
}
