export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getSession } from '../../../lib/adminAuth';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  if (!env?.COURSE_ASSETS) {
    return new Response(
      JSON.stringify({ error: 'Image storage isn\u2019t configured yet (COURSE_ASSETS R2 bucket missing).' }),
      { status: 500 }
    );
  }

  const form = await request.formData();
  const file = form.get('image');
  if (!(file instanceof File)) return new Response(JSON.stringify({ error: 'No image provided' }), { status: 400 });
  if (!ALLOWED.has(file.type)) return new Response(JSON.stringify({ error: 'Unsupported image type' }), { status: 400 });
  if (file.size > MAX_BYTES) return new Response(JSON.stringify({ error: 'Image must be under 5MB' }), { status: 400 });

  const ext = file.type.split('/')[1] || 'jpg';
  const key = `courses/${crypto.randomUUID()}.${ext}`;
  await env.COURSE_ASSETS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

  // Belt-and-suspenders: confirm the object is actually retrievable before
  // telling the client (and letting it save this URL to D1) that the upload
  // succeeded. Without this, a put() that silently didn't persist would
  // still return a "successful" URL that 404s forever afterward, with the
  // broken reference then saved to the course row and no error anywhere.
  const verify = await env.COURSE_ASSETS.head(key);
  if (!verify) {
    return new Response(
      JSON.stringify({ error: 'Upload did not persist to storage. Please try again.' }),
      { status: 500 }
    );
  }

  return new Response(JSON.stringify({ url: `/api/courses/image/${key}` }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
};
