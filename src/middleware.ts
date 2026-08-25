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

  // Trailing-slash canonicalization. The site now standardizes on
  // always-slash (see astro.config.mjs), but plenty of already-indexed
  // URLs and internal links still hit the no-slash form (e.g. /services,
  // /book, /articles/some-post). Those need a real 301 to the slash form,
  // not just a config setting, both to consolidate the GSC duplicates and
  // so the two forms stop rendering as separate "valid" pages.
  //
  // Left alone on purpose:
  // - /api/* — these are JSON/form endpoints, not pages; appending a
  //   slash would change the route (or 404 it) rather than canonicalize it.
  // - anything with a file extension (.xml, .png, .txt, .css, ...) — these
  //   are assets, not pages, and never take a trailing slash.
  // - non-GET/HEAD requests — never redirect a POST/PUT/DELETE, that would
  //   silently drop the request body.
  const { pathname } = url;
  const lastSegment = pathname.split('/').pop() ?? '';
  const looksLikeFile = lastSegment.includes('.');

  if (
    (context.request.method === 'GET' || context.request.method === 'HEAD') &&
    !pathname.endsWith('/') &&
    !pathname.startsWith('/api/') &&
    !looksLikeFile
  ) {
    const target = new URL(pathname + '/' + url.search, url.origin);
    return context.redirect(target.toString(), 301);
  }

  return next();
});
