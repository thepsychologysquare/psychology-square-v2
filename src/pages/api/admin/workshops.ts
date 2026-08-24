import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getSession } from '../../../lib/adminAuth';
import {
  listAllWorkshops, getWorkshopBySlug, generateUniqueSlug, createWorkshop, updateWorkshop,
  confirmWorkshop, cancelWorkshop, countActiveEnrollments, ALLOWED_CATEGORIES, WORKSHOP_MIN_SEATS_DEFAULT,
} from '../../../lib/workshops';
import { sendWorkshopConfirmedEmail } from '../../../lib/email';

export const prerender = false;

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } });
}

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return jsonError('Not signed in.', 401);

  const workshops = await listAllWorkshops(env);
  return new Response(JSON.stringify({ workshops }), { status: 200, headers: { 'content-type': 'application/json' } });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return jsonError('Not signed in.', 401);

  const body = await request.json().catch(() => null);
  if (!body?.title?.trim()) return jsonError('Title is required.', 400);
  if (!Number.isFinite(body.pricePkr) || body.pricePkr < 0) return jsonError('A valid price is required.', 400);

  let category = String(body.category || 'general').trim().toLowerCase();
  if (!(ALLOWED_CATEGORIES as readonly string[]).includes(category)) category = 'general';

  const slug = await generateUniqueSlug(env, body.title.trim());
  await createWorkshop(env, slug, {
    title: body.title.trim(),
    description: body.description || '',
    category,
    instructor: body.instructor || '',
    pricePkr: body.pricePkr,
    minSeats: Number.isFinite(body.minSeats) ? body.minSeats : WORKSHOP_MIN_SEATS_DEFAULT,
    maxSeats: Number.isFinite(body.maxSeats) ? body.maxSeats : null,
    image: body.image ?? null,
    imageAlt: body.imageAlt ?? null,
    draft: body.draft !== false,
  });

  return new Response(JSON.stringify({ slug }), { status: 201, headers: { 'content-type': 'application/json' } });
};

// Handles both a plain field edit and the two one-way actions
// ('confirm' / 'cancel') via an `action` field in the body, so the studio
// UI only needs one endpoint to talk to.
export const PATCH: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return jsonError('Not signed in.', 401);

  const body = await request.json().catch(() => null);
  const slug = typeof body?.slug === 'string' ? body.slug : '';
  if (!slug) return jsonError('Missing workshop slug.', 400);

  const workshop = await getWorkshopBySlug(env, slug);
  if (!workshop) return jsonError('Workshop not found.', 404);

  if (body.action === 'confirm') {
    const scheduledAt = String(body.scheduledAt || '').trim();
    const meetLink = String(body.meetLink || '').trim();
    if (!scheduledAt) return jsonError('Please provide a date/time.', 400);
    if (!meetLink) return jsonError('Please provide the Google Meet link.', 400);

    const activeCount = await countActiveEnrollments(env, slug);
    if (activeCount < workshop.min_seats) {
      return jsonError(`Only ${activeCount} of ${workshop.min_seats} required seats are approved — approve more enrollments first, or confirm anyway isn't supported to avoid running an under-filled cohort by accident.`, 400);
    }

    await confirmWorkshop(env, slug, scheduledAt, meetLink);

    const { results: enrollees } = await env.DB.prepare(
      `SELECT name, email FROM workshop_enrollments WHERE workshop_slug = ? AND status = 'active'`
    ).bind(slug).all();

    for (const person of enrollees as { name: string; email: string }[]) {
      await sendWorkshopConfirmedEmail(env, {
        toEmail: person.email, toName: person.name, workshopTitle: workshop.title, scheduledAt, meetLink,
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ ok: true, notified: enrollees.length }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  if (body.action === 'cancel') {
    await cancelWorkshop(env, slug);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // Plain field edit.
  const patch: Record<string, any> = {};
  for (const key of ['title', 'description', 'instructor', 'pricePkr', 'minSeats', 'maxSeats', 'image', 'imageAlt', 'draft']) {
    if (key in body) patch[key] = body[key];
  }
  if ('category' in body) {
    let category = String(body.category || 'general').trim().toLowerCase();
    if (!(ALLOWED_CATEGORIES as readonly string[]).includes(category)) category = 'general';
    patch.category = category;
  }
  if (Object.keys(patch).length === 0) return jsonError('Nothing to update.', 400);

  await updateWorkshop(env, slug, patch);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};
