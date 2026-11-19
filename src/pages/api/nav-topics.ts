import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listCourses } from '../../lib/courses';
import { courseCategoryLabelMap } from '../../lib/courseCategories';
import { listPublicWorkshops } from '../../lib/workshops';
import { categoryLabelMap } from '../../lib/workshopCategories';

// Feeds the Courses / Workshops mega-menu in the nav (src/layouts/Layout.astro).
//
// Why an endpoint instead of querying inside Layout: most pages that use the
// layout (articles, services, home...) are prerendered at build time, where
// the D1 database isn't reachable. Course and workshop topics live in D1 and
// change from the dashboard without a redeploy, so the nav fetches them live
// from here and fills the slider in the browser. Only topics that currently
// have at least one published course/workshop are returned, same idea as the
// Articles menu only listing categories that are in use.

export const prerender = false;

type Topic = { slug: string; label: string; image: string | null };

function titleCase(slug: string) {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export const GET: APIRoute = async ({ url }) => {
  const kind = url.searchParams.get('kind');
  let topics: Topic[] = [];

  try {
    if (kind === 'courses') {
      const courses = await listCourses(env, { includeDrafts: false });
      const labels = await courseCategoryLabelMap(env);
      const bySlug = new Map<string, Topic>();
      for (const c of courses) {
        const slug = c.data.category;
        if (!slug) continue;
        const existing = bySlug.get(slug);
        if (!existing) {
          bySlug.set(slug, { slug, label: labels[slug] || titleCase(slug), image: c.data.image || null });
        } else if (!existing.image && c.data.image) {
          existing.image = c.data.image;
        }
      }
      topics = [...bySlug.values()];
    } else if (kind === 'workshops') {
      const workshops = await listPublicWorkshops(env);
      const labels = await categoryLabelMap(env);
      const bySlug = new Map<string, Topic>();
      for (const w of workshops) {
        const slug = w.category;
        if (!slug) continue;
        const existing = bySlug.get(slug);
        if (!existing) {
          bySlug.set(slug, { slug, label: labels[slug] || titleCase(slug), image: w.image || null });
        } else if (!existing.image && w.image) {
          existing.image = w.image;
        }
      }
      topics = [...bySlug.values()];
    } else {
      return new Response(JSON.stringify({ error: 'Unknown kind' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
  } catch {
    topics = [];
  }

  topics.sort((a, b) => a.label.localeCompare(b.label));

  return new Response(JSON.stringify({ topics }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=300',
    },
  });
};
