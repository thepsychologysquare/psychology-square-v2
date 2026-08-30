// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://thepsychologysquare.com',
  // Canonical form is still always-slash (matches how the site already
  // links internally: /articles/, /services/therapy/, /team/,
  // /resources/worksheets/...), and that redirect is enforced for real
  // pages by src/middleware.ts, which already excludes /api/* and any
  // file-extension path from the redirect.
  //
  // This is set to 'ignore' rather than 'always' because Astro's own
  // built-in trailing-slash enforcement has a routing bug for dynamic
  // catch-all endpoints whose URL ends in a file extension (e.g.
  // src/pages/api/courses/image/[...key].ts serving "*.png"): Astro
  // incorrectly requires a trailing slash that a file URL can never have,
  // so the route never matches and Astro serves its own 404 page instead
  // of the endpoint. Since middleware.ts already does the real redirect
  // work by hand, Astro's built-in enforcement here is redundant for pages
  // and actively harmful for these API routes — so it's switched off.
  trailingSlash: 'ignore',
  adapter: cloudflare({
    prerenderEnvironment: 'node',
  }),
  // Legacy URLs from the pre-migration site. These already 404 correctly,
  // but a 301 to the closest current equivalent consolidates any old
  // link/search equity instead of losing it, and gets Google to swap the
  // indexed URL over rather than waiting on a 404 to fall out naturally.
  // Add more here as the full list of old indexed URLs comes in from GSC.
  redirects: {
    '/contact-us': '/contact',
    '/terms-of-service': '/terms',
    '/worksheets/goal-achievement-framework-worksheet': '/resources/worksheets',
    '/worksheets/locus-of-control-worksheet': '/resources/worksheets',
    // No current equivalent for these — left as a clean 404 on purpose:
    // /about-us, /psychology-books, /addiction-and-trauma
  },
  integrations: [
    sitemap({
      // Keep the sitemap to public, indexable, non-thin content only.
      // Legal pages (terms, privacy, refund-and-cancellation, disclaimer)
      // are real, unique, indexable content, so they're intentionally
      // NOT filtered out here. /articles/category/ and /assessments/ are
      // filtered out deliberately — thin/duplicate listing pages that
      // don't need to be indexed on their own.
      filter: (page) =>
        !page.includes('/dashboard/') &&
        !page.includes('/my-certificates/') &&
        !page.includes('/certificates/') &&
        !page.includes('/articles/category/') &&
        // Real assessments listing (the one the audit meant) plus the old
        // pre-migration /assessments/ URL, which is now just a redirect
        // stub with no content of its own and shouldn't be indexed either.
        page !== 'https://thepsychologysquare.com/resources/assessments/' &&
        page !== 'https://thepsychologysquare.com/assessments/',
    }),
  ],
});
