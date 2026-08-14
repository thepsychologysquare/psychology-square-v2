import { defineMiddleware } from 'astro:middleware';

// The canonical host is the apex domain (see astro.config.mjs `site`).
// www.thepsychologysquare.com should never serve content directly — if a
// request somehow reaches the Worker on the www host (e.g. a stale DNS
// cache, a direct IP hit with a www Host header, or the Cloudflare-level
// redirect rule not covering some edge case), bounce it to the apex with
// a permanent redirect and preserve the full path + querystring.
//
// Note: this does NOT fix DNS resolution failures — if www's DNS record
// is missing/broken, requests never reach this code at all. The DNS/
// Cloudflare-dashboard fix is still required; this is just a safety net.
const CANONICAL_HOST = 'thepsychologysquare.com';
const WWW_HOST = 'www.thepsychologysquare.com';

export const onRequest = defineMiddleware((context, next) => {
  const url = context.url;

  if (url.hostname === WWW_HOST) {
    const target = new URL(url.pathname + url.search + url.hash, `https://${CANONICAL_HOST}`);
    return context.redirect(target.toString(), 301);
  }

  return next();
});
