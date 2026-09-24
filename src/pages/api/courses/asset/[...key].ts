export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

// Generic sibling of /api/courses/image/[...key] for non-image course
// assets (currently: uploaded PDFs). Kept as a separate route rather than
// reusing the image one so nothing about image serving changes.
export const GET: APIRoute = async ({ params }) => {
  const key = params.key;
  if (!key || !env?.COURSE_ASSETS) {
    return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  const object = await env.COURSE_ASSETS.get(key);
  if (!object) {
    // See the image route for why this is no-store: avoids a transient
    // miss (e.g. a request racing a very recent upload) getting cached
    // as a permanent 404 at the edge.
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
