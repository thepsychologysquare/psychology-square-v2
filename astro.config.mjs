// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://thepsychologysquare.com',
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
      filter: (page) =>
        !page.includes('/dashboard/') &&
        !page.includes('/my-certificates/') &&
        !page.includes('/certificates/') &&
        !page.includes('/terms/') &&
        !page.includes('/privacy/') &&
        !page.includes('/refund-and-cancellation/') &&
        !page.includes('/disclaimer/') &&
        !page.includes('/articles/category/') &&
        page !== 'https://thepsychologysquare.com/assessments/',
    }),
  ],
});
