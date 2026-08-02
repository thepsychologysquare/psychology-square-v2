// Shared helpers for the D1-backed course builder (modules + steps).
// Used by both the admin builder API and the public step player.

export interface CourseStepRow {
  id: string;
  module_id: string;
  title: string;
  content_type: 'text' | 'video';
  content_body: string | null;
  video_url: string | null;
  sequence_order: number;
  question: string | null;
  question_options: string | null; // JSON string
  question_correct_index: number | null;
}

export interface CourseModuleRow {
  id: string;
  course_slug: string;
  title: string;
  sequence_order: number;
}

export interface ModuleWithSteps extends CourseModuleRow {
  steps: CourseStepRow[];
}

export async function getCourseOutline(db: any, courseSlug: string): Promise<ModuleWithSteps[]> {
  const modules = (
    await db
      .prepare(`SELECT * FROM course_modules WHERE course_slug = ? ORDER BY sequence_order, created_at`)
      .bind(courseSlug)
      .all()
  ).results as CourseModuleRow[];

  const steps = (
    await db
      .prepare(
        `SELECT s.* FROM course_steps s
         JOIN course_modules m ON s.module_id = m.id
         WHERE m.course_slug = ?
         ORDER BY s.sequence_order, s.created_at`
      )
      .bind(courseSlug)
      .all()
  ).results as CourseStepRow[];

  return modules.map((m) => ({ ...m, steps: steps.filter((s) => s.module_id === m.id) }));
}

export async function getCompletedStepIds(db: any, courseSlug: string, email: string): Promise<Set<string>> {
  const rows = (
    await db
      .prepare(`SELECT step_id FROM step_completions WHERE course_slug = ? AND email = ?`)
      .bind(courseSlug, email.trim().toLowerCase())
      .all()
  ).results as { step_id: string }[];
  return new Set(rows.map((r) => r.step_id));
}

// Very small, dependency-free text renderer: escapes HTML, then turns
// blank-line-separated blocks into paragraphs and single newlines into
// <br>. Good enough for lesson text typed into a plain textarea without
// pulling in a markdown library.
export function textToHtml(text: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escape(block.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}
