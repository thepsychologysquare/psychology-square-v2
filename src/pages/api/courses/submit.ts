import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getEntry } from 'astro:content';
import { makeCertificateId } from '../../../lib/certificate';
import { sendCertificateEmail } from '../../../lib/email';

export const prerender = false;

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request }) => {
  if (!env?.DB) {
    return jsonError('Course system is not configured yet.', 500);
  }

  const body = await request.json().catch(() => null);
  const courseSlug = typeof body?.courseSlug === 'string' ? body.courseSlug : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const answers = Array.isArray(body?.answers) ? body.answers : null;

  if (!courseSlug) return jsonError('Missing course.', 400);
  if (!name || name.length > 200) return jsonError('Please enter your name.', 400);
  if (!EMAIL_RE.test(email) || email.length > 200) return jsonError('Please enter a valid email address.', 400);
  if (!answers) return jsonError('Missing quiz answers.', 400);

  // Server-side gate: only an enrolled email can submit for this course,
  // regardless of what the page's client-side JS did or didn't check.
  const enrollment = await env.DB.prepare(
    `SELECT 1 FROM enrollments WHERE course_slug = ? AND email = ?`
  ).bind(courseSlug, email).first();
  if (!enrollment) return jsonError('Please enroll in this course before submitting the quiz.', 403);

  const course = await getEntry('courses', courseSlug);
  if (!course || course.data.draft) {
    return jsonError('That course could not be found.', 404);
  }

  const quiz = course.data.quiz;
  if (answers.length !== quiz.length) {
    return jsonError('Please answer every question.', 400);
  }

  // Grade server-side only — correctIndex never leaves the server, so
  // there's nothing in the client for someone to inspect or tamper with.
  let correctCount = 0;
  for (let i = 0; i < quiz.length; i++) {
    if (answers[i] === quiz[i].correctIndex) correctCount++;
  }
  const scorePercent = Math.round((correctCount / quiz.length) * 100);
  const passed = scorePercent >= course.data.passScorePercent;
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO course_attempts (course_slug, course_title, name, email, score_percent, passed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(courseSlug, course.data.title, name, email, scorePercent, passed ? 1 : 0, now).run();

  if (!passed) {
    return new Response(JSON.stringify({ passed: false, scorePercent, passScorePercent: course.data.passScorePercent }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const certificateId = makeCertificateId();
  try {
    await env.DB.prepare(
      `INSERT INTO certificates (id, course_slug, course_title, ce_hours, name, email, score_percent, issued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(certificateId, courseSlug, course.data.title, course.data.estimatedHours, name, email, scorePercent, now).run();
  } catch {
    return jsonError('You passed, but the certificate could not be saved. Please try submitting again.', 500);
  }

  const certUrl = new URL(`/certificates/${certificateId}`, request.url).toString();
  const emailResult = await sendCertificateEmail(env, {
    toEmail: email,
    toName: name,
    courseTitle: course.data.title,
    certUrl,
    certificateId,
  });

  return new Response(JSON.stringify({
    passed: true,
    scorePercent,
    certificateId,
    certUrl,
    emailSent: emailResult.ok,
    emailError: emailResult.ok ? undefined : emailResult.error,
  }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
};
