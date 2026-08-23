// @astrojs/sitemap only knows about statically-prerendered routes. Every
// course page (/courses, /courses/[slug]) sets `prerender = false` because
// its content depends on the D1-backed course entity + enrollment session,
// so those URLs never make it into the generated sitemap-index.xml — a
// real gap, since they're the pages this SEO pass cares most about.
//
// This route fills that gap with its own small, valid sitemap, listed
// alongside the main one in robots.txt (a robots.txt file can point to any
// number of Sitemap: entries, and Google reads them all).
export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listCourses } from '../lib/courses';

const siteOrigin = 'https://thepsychologysquare.com';

export const GET: APIRoute = async () => {
  const courses = await listCourses(env, { includeDrafts: false });

  const urls = [
    { loc: `${siteOrigin}/courses`, priority: '0.9' },
    ...courses.map((c) => ({
      loc: `${siteOrigin}/courses/${c.id}`,
      priority: '0.8',
    })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <priority>${u.priority}</priority>\n  </url>`).join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
};
