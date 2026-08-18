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
