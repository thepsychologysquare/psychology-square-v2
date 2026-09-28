import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { isReviewKind, verifyReviewToken, loadReviewItem } from '../../../../../lib/paymentReview';

export const prerender = false;

// Serves the payment screenshot for the link in the admin notification
// emails. Same signed token as the review page (see lib/paymentReview.ts),
// so it works without a dashboard login but only for that one submission.
export const GET: APIRoute = async ({ params, url }) => {
  const kind = params.kind;
  const id = params.id ?? '';
  const token = url.searchParams.get('t');
  if (!isReviewKind(kind) || !id || !(await verifyReviewToken(env?.ADMIN_SESSION_SECRET, kind, id, token))) {
    return new Response('This link is invalid or has expired.', { status: 403 });
  }

  const item = await loadReviewItem(env, kind, id);
  if (!item || !item.screenshotKey) return new Response('Not found.', { status: 404 });

  const object = await env.SCREENSHOTS.get(item.screenshotKey);
  if (!object) return new Response('Not found.', { status: 404 });

  return new Response(object.body, {
    status: 200,
    headers: {
      'content-type': item.screenshotType || 'application/octet-stream',
      'cache-control': 'private, max-age=3600',
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'no-referrer',
    },
  });
};
