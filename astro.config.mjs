// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.thepsychologysquare.com',
  adapter: cloudflare({
    prerenderEnvironment: 'node',
  }),
  integrations: [
    sitemap({
      // Keep the sitemap to public, indexable content only — login-gated
      // dashboard pages and personal certificate lookups don't belong in
      // it (dashboard is already blocked in robots.txt; listing it here
      // too just creates "blocked by robots.txt" noise in Search Console).
      // Keep the sitemap to pages worth Google prioritizing:
      // - dashboard/certificates: login-gated, already blocked in robots.txt
      // - terms/privacy/refund-and-cancellation/disclaimer: legal boilerplate,
      //   no search value, still reachable normally via the footer
      // - /assessments: a legacy redirect stub (301 -> /resources/assessments),
      //   not real content
      filter: (page) =>
        !page.includes('/dashboard/') &&
        !page.includes('/my-certificates/') &&
        !page.includes('/certificates/') &&
        !page.includes('/terms/') &&
        !page.includes('/privacy/') &&
        !page.includes('/refund-and-cancellation/') &&
        !page.includes('/disclaimer/') &&
        page !== 'https://www.thepsychologysquare.com/assessments/',
    }),
  ],
});