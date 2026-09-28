import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getSession } from '../../../lib/adminAuth';
import { sendWorkshopEnrollmentStatusEmail, sendWorkshopCertificateEmail } from '../../../lib/email';
import { makeCertificateId } from '../../../lib/certificate';

export const prerender = false;

// Same review-queue pattern as /api/admin/course-enrollments.ts, scoped to
// workshop_enrollments instead. Optional ?slug= filters to one workshop
// (used by the workshop detail page in the studio); omitted shows every
// pending request across all workshops.
export const GET: APIRoute = async ({ request, url }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const slug = url.searchParams.get('slug');
  const { results } = slug
    ? await env.DB.prepare(
        `SELECT id, workshop_slug, workshop_title, name, email, phone, notes, status, amount_pkr, payment_method,
                screenshot_type, created_at, reviewed_at, completed_at, certificate_id
         FROM workshop_enrollments WHERE workshop_slug = ? ORDER BY created_at DESC LIMIT 500`
      ).bind(slug).all()
    : await env.DB.prepare(
        `SELECT id, workshop_slug, workshop_title, name, email, phone, notes, status, amount_pkr, payment_method,
                screenshot_type, created_at, reviewed_at, completed_at, certificate_id
         FROM workshop_enrollments ORDER BY created_at DESC LIMIT 500`
      ).all();

  return new Response(JSON.stringify({ requests: results }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const VALID_STATUSES = new Set(['active', 'declined']);

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

export const PATCH: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const body = await request.json().catch(() => null);

  // ---- "Mark complete": issue the workshop certificate + email it ----------
  // Reuses the same certificates table and /certificates/[id] page as
  // courses (kind = 'workshop' only changes the wording). Safe to call
  // twice: if this signup already has a certificate, no second one is
  // created -- the email is just sent again (that's the "Resend" button).
  if (body?.action === 'complete') {
    const cid = typeof body?.id === 'string' ? body.id : '';
    if (!cid) return json({ error: 'Invalid request.' }, 400);

    const row = await env.DB.prepare(
      `SELECT id, workshop_slug, workshop_title, name, email, status, certificate_id
       FROM workshop_enrollments WHERE id = ?`
    ).bind(cid).first<{
      id: string; workshop_slug: string; workshop_title: string; name: string; email: string;
      status: string; certificate_id: string | null;
    }>();
    if (!row) return json({ error: 'Not found.' }, 404);
    if (row.status !== 'active') return json({ error: 'Only confirmed signups can be marked complete.' }, 400);

    // Reuse the existing certificate if it's still there; if it was deleted
    // from the Certificates tab, issue a fresh one rather than emailing a dead link.
    let certificateId = row.certificate_id;
    let alreadyIssued = false;
    if (certificateId) {
      const still = await env.DB.prepare(`SELECT 1 AS ok FROM certificates WHERE id = ?`).bind(certificateId).first();
      if (still) alreadyIssued = true; else certificateId = null;
    }
    if (!certificateId) {
      certificateId = makeCertificateId();
      const now = new Date().toISOString();
      try {
        await env.DB.batch([
          // is_paid = 1 -> the navy/gold design. ce_hours / score_percent are
          // NOT NULL in the table, so 0 -- neither is shown for workshops.
          env.DB.prepare(
            `INSERT INTO certificates (id, course_slug, course_title, ce_hours, name, email, score_percent, issued_at, is_paid, kind)
             VALUES (?, ?, ?, 0, ?, ?, 0, ?, 1, 'workshop')`
          ).bind(certificateId, row.workshop_slug, row.workshop_title, row.name, row.email, now),
          env.DB.prepare(
            `UPDATE workshop_enrollments SET completed_at = ?, certificate_id = ? WHERE id = ?`
          ).bind(now, certificateId, row.id),
        ]);
      } catch {
        return json({ error: 'Could not save the certificate. Please try again.' }, 500);
      }
    }

    const certificateUrl = new URL(`/certificates/${certificateId}`, request.url).toString();
    const sent = await sendWorkshopCertificateEmail(env, {
      toEmail: row.email, toName: row.name, workshopTitle: row.workshop_title, certificateUrl,
    }).catch(() => ({ ok: false }));

    return json({ ok: true, certificateId, alreadyIssued, emailed: !!sent.ok });
  }

  const id = typeof body?.id === 'string' ? body.id : '';
  const status = body?.status;
  if (!id || !VALID_STATUSES.has(status)) {
    return new Response(JSON.stringify({ error: 'Invalid request.' }), { status: 400 });
  }

  const updated = await env.DB.prepare(
    `UPDATE workshop_enrollments SET status = ?, reviewed_at = ? WHERE id = ?
     RETURNING id, workshop_slug, workshop_title, name, email, status`
  ).bind(status, new Date().toISOString(), id).first<{
    id: string; workshop_slug: string; workshop_title: string; name: string; email: string; status: string;
  }>();

  if (!updated) {
    return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 });
  }

  await sendWorkshopEnrollmentStatusEmail(env, {
    toEmail: updated.email, toName: updated.name, workshopTitle: updated.workshop_title,
    status: status as 'active' | 'declined',
  }).catch(() => {});

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'Missing id.' }), { status: 400 });

  const row = await env.DB.prepare(
    `SELECT screenshot_key FROM workshop_enrollments WHERE id = ?`
  ).bind(id).first<{ screenshot_key: string | null }>();

  await env.DB.prepare(`DELETE FROM workshop_enrollments WHERE id = ?`).bind(id).run();
  if (row?.screenshot_key) {
    await env.SCREENSHOTS.delete(row.screenshot_key).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};
