export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getSession } from '../../../lib/adminAuth';
import { getCourseOutline } from '../../../lib/courseBuilder';

async function requireAdmin(request: Request) {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  return session;
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!(await requireAdmin(request))) return new Response('Unauthorized', { status: 401 });
  const courseSlug = url.searchParams.get('course');
  if (!courseSlug) return new Response(JSON.stringify({ error: 'course is required' }), { status: 400 });
  const outline = await getCourseOutline(env.DB, courseSlug);
  return new Response(JSON.stringify({ modules: outline }), { headers: { 'content-type': 'application/json' } });
};

export const POST: APIRoute = async ({ request }) => {
  if (!(await requireAdmin(request))) return new Response('Unauthorized', { status: 401 });
  const body = await request.json();
  const now = new Date().toISOString();

  if (body.kind === 'module') {
    const { courseSlug, title } = body;
    if (!courseSlug || !title) return new Response(JSON.stringify({ error: 'courseSlug and title are required' }), { status: 400 });
    const max = await env.DB.prepare(
      `SELECT COALESCE(MAX(sequence_order), -1) AS m FROM course_modules WHERE course_slug = ?`
    ).bind(courseSlug).first<{ m: number }>();
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO course_modules (id, course_slug, title, sequence_order, created_at) VALUES (?, ?, ?, ?, ?)`
    ).bind(id, courseSlug, title, (max?.m ?? -1) + 1, now).run();
    return new Response(JSON.stringify({ id }), { status: 201, headers: { 'content-type': 'application/json' } });
  }

  if (body.kind === 'step') {
    const { moduleId, title, contentType, contentBody, videoUrl, question, questionOptions, questionCorrectIndex } = body;
    if (!moduleId || !title) return new Response(JSON.stringify({ error: 'moduleId and title are required' }), { status: 400 });
    const max = await env.DB.prepare(
      `SELECT COALESCE(MAX(sequence_order), -1) AS m FROM course_steps WHERE module_id = ?`
    ).bind(moduleId).first<{ m: number }>();
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO course_steps
        (id, module_id, title, content_type, content_body, video_url, sequence_order, question, question_options, question_correct_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, moduleId, title, contentType === 'video' ? 'video' : 'text',
      contentBody || null, videoUrl || null, (max?.m ?? -1) + 1,
      question || null, question ? JSON.stringify(questionOptions || []) : null,
      question ? (questionCorrectIndex ?? 0) : null, now, now
    ).run();
    return new Response(JSON.stringify({ id }), { status: 201, headers: { 'content-type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'Unknown kind' }), { status: 400 });
};

export const PATCH: APIRoute = async ({ request }) => {
  if (!(await requireAdmin(request))) return new Response('Unauthorized', { status: 401 });
  const body = await request.json();
  const { kind, id, move } = body;

  // Batch reorder from drag-and-drop: { kind, reorder: [id1, id2, ...] } in
  // the new desired order. Used instead of one PATCH per up/down click.
  if (body.reorder && Array.isArray(body.reorder)) {
    const table = kind === 'module' ? 'course_modules' : 'course_steps';
    const statements = body.reorder.map((rowId: string, index: number) =>
      env.DB.prepare(`UPDATE ${table} SET sequence_order = ? WHERE id = ?`).bind(index, rowId)
    );
    if (statements.length > 0) await env.DB.batch(statements);
    return new Response(JSON.stringify({ ok: true }));
  }

  if (!kind || !id) return new Response(JSON.stringify({ error: 'kind and id are required' }), { status: 400 });

  const table = kind === 'module' ? 'course_modules' : 'course_steps';
  const parentCol = kind === 'module' ? 'course_slug' : 'module_id';

  if (move === 'up' || move === 'down') {
    const current = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<any>();
    if (!current) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    const dir = move === 'up' ? '<' : '>';
    const order = move === 'up' ? 'DESC' : 'ASC';
    const neighbor = await env.DB.prepare(
      `SELECT * FROM ${table} WHERE ${parentCol} = ? AND sequence_order ${dir} ? ORDER BY sequence_order ${order} LIMIT 1`
    ).bind(current[parentCol], current.sequence_order).first<any>();
    if (neighbor) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE ${table} SET sequence_order = ? WHERE id = ?`).bind(neighbor.sequence_order, current.id),
        env.DB.prepare(`UPDATE ${table} SET sequence_order = ? WHERE id = ?`).bind(current.sequence_order, neighbor.id),
      ]);
    }
    return new Response(JSON.stringify({ ok: true }));
  }

  // Field edits
  if (kind === 'module') {
    if (typeof body.title === 'string') {
      await env.DB.prepare(`UPDATE course_modules SET title = ? WHERE id = ?`).bind(body.title, id).run();
    }
  } else {
    const fields: Record<string, any> = {};
    if (typeof body.title === 'string') fields.title = body.title;
    if (typeof body.contentType === 'string') fields.content_type = body.contentType === 'video' ? 'video' : 'text';
    if (typeof body.contentBody === 'string') fields.content_body = body.contentBody;
    if (typeof body.videoUrl === 'string') fields.video_url = body.videoUrl;
    if ('question' in body) fields.question = body.question || null;
    if ('questionOptions' in body) fields.question_options = body.question ? JSON.stringify(body.questionOptions || []) : null;
    if ('questionCorrectIndex' in body) fields.question_correct_index = body.question ? (body.questionCorrectIndex ?? 0) : null;
    if (Object.keys(fields).length > 0) {
      fields.updated_at = new Date().toISOString();
      const setClause = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
      await env.DB.prepare(`UPDATE course_steps SET ${setClause} WHERE id = ?`).bind(...Object.values(fields), id).run();
    }
  }
  return new Response(JSON.stringify({ ok: true }));
};

export const DELETE: APIRoute = async ({ request, url }) => {
  if (!(await requireAdmin(request))) return new Response('Unauthorized', { status: 401 });
  const kind = url.searchParams.get('kind');
  const id = url.searchParams.get('id');
  if (!kind || !id) return new Response(JSON.stringify({ error: 'kind and id are required' }), { status: 400 });
  const table = kind === 'module' ? 'course_modules' : 'course_steps';
  await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  return new Response(JSON.stringify({ ok: true }));
};
