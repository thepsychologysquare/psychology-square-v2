export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const GET: APIRoute = async ({ params }) => {
  const key = params.key;
  if (!key || !env?.COURSE_ASSETS) return new Response('Not found', { status: 404 });

  // params.key already carries the full R2 object key (e.g. "courses/<uuid>.jpg")
  // since the upload endpoint's returned URL is /api/courses/image/<key>.
  const object = await env.COURSE_ASSETS.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  return new Response(object.body, {
    status: 200,
    headers: {
      'content-type': object.httpMetadata?.contentType || 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};
