export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const GET: APIRoute = async ({ params }) => {
  const key = params.key;
  if (!key || !env?.COURSE_ASSETS) {
    return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  // params.key already carries the full R2 object key (e.g. "courses/<uuid>.jpg")
  // since the upload endpoint's returned URL is /api/courses/image/<key>.
  const object = await env.COURSE_ASSETS.get(key);
  if (!object) {
    // Cloudflare's edge caches responses for file-extension-looking paths
    // (.jpg, .jpeg, .png, ...) by default, even dynamically-generated ones,
    // even with no explicit cache header at all. Without this, a single
    // request that loses a timing race against a very recent upload gets a
    // 404 here that the edge then serves forever for that exact URL, even
    // though the object is really sitting in R2 the whole time. no-store
    // guarantees a transient miss is never permanently cached as "missing".
    return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  return new Response(object.body, {
    status: 200,
    headers: {
      'content-type': object.httpMetadata?.contentType || 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};
