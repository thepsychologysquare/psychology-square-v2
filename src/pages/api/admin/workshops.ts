import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getSession } from '../../../lib/adminAuth';
import {
  listAllWorkshops, getWorkshopBySlug, generateUniqueSlug, createWorkshop, updateWorkshop,
  deleteWorkshop, WORKSHOP_MIN_SEATS_DEFAULT,
} from '../../../lib/workshops';
import { validateCategory } from '../../../lib/workshopCategories';

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

  const category = await validateCategory(env, body.category);

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
    scheduledAt: body.scheduledAt ?? null,
    draft: body.draft !== false,
  });

  return new Response(JSON.stringify({ slug }), { status: 201, headers: { 'content-type': 'application/json' } });
};

// Plain field edit only now — publish/unpublish is just `draft`, same as
// courses, and "confirm"/"cancel" cohort actions were removed: the admin
// sets a free-text tentative date (`scheduledAt`) whenever they like and
// messages enrollees manually once a time is settled.
export const PATCH: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return jsonError('Not signed in.', 401);

  const body = await request.json().catch(() => null);
  const slug = typeof body?.slug === 'string' ? body.slug : '';
  if (!slug) return jsonError('Missing workshop slug.', 400);

  const workshop = await getWorkshopBySlug(env, slug);
  if (!workshop) return jsonError('Workshop not found.', 404);

  const patch: Record<string, any> = {};
  for (const key of ['title', 'description', 'instructor', 'pricePkr', 'minSeats', 'maxSeats', 'image', 'imageAlt', 'draft', 'scheduledAt']) {
    if (key in body) patch[key] = body[key];
  }
  if ('category' in body) {
    patch.category = await validateCategory(env, body.category);
  }
  if (Object.keys(patch).length === 0) return jsonError('Nothing to update.', 400);

  await updateWorkshop(env, slug, patch);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};

// Full delete — the workshop and every enrollment tied to it. Screenshot
// cleanup in R2 happens here too since this route has the binding.
export const DELETE: APIRoute = async ({ request, url }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return jsonError('Not signed in.', 401);

  const slug = url.searchParams.get('slug');
  if (!slug) return jsonError('Missing workshop slug.', 400);

  const workshop = await getWorkshopBySlug(env, slug);
  if (!workshop) return jsonError('Workshop not found.', 404);

  const { results: shots } = await env.DB.prepare(
    `SELECT screenshot_key FROM workshop_enrollments WHERE workshop_slug = ? AND screenshot_key IS NOT NULL`
  ).bind(slug).all();

  await deleteWorkshop(env, slug);

  for (const row of shots as { screenshot_key: string }[]) {
    if (row.screenshot_key) await env.SCREENSHOTS.delete(row.screenshot_key).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};
