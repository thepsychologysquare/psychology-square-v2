# Course Builder Studio — what changed & how to deploy it

This drops in over your existing repo. Every file here goes at the same
path it's in inside this zip. Nothing in your `src/content/courses/*.md`
files was touched — your 3 existing courses migrate over with identical
values (title, description, quiz, pricing, everything).

## What this does

- **Decap is out of the picture for courses.** Everything about a course —
  title, slug, description, topic, author, hours, cover image, pricing,
  pass score, the certificate quiz, and every module/lesson — is now
  created and edited at `/dashboard/courses`. Nothing to commit to git,
  nothing to wait on a rebuild for.
- **Old courses keep working exactly as before** until you touch them.
  A course only becomes "Studio-managed" the moment you edit anything
  about it from the new dashboard (or it's pre-migrated below) — until
  then it's still served from its Decap markdown file, unchanged.
- **The course builder page itself was rebuilt** per the redesign brief:
  a real two-pane Studio (30% tree / 70% workspace), drag-and-drop
  reordering for modules and lessons (plain HTML5 drag-and-drop — no new
  npm dependencies), a "Course settings" tab for the entity-level fields
  and quiz, debounced autosave with a status indicator, and a stripped
  admin layout with no public nav bleeding into it.
- **Decap's own "Courses" collection is removed** from `public/admin/config.yml`
  (with a comment explaining why) so there's exactly one place to manage
  a course, not two that can drift out of sync. Articles, worksheets, and
  assessments are untouched — those stay in Decap since you didn't flag
  them as a problem.

## Files in this drop

```
migrations-2026-08-course-entity.sql        NEW  — run this once (see below)
wrangler.jsonc                              EDIT — adds a COURSE_ASSETS R2 binding
src/lib/courses.ts                          NEW  — the D1↔Decap merge layer
src/pages/api/admin/courses.ts              NEW  — course entity CRUD (title/slug/pricing/quiz/publish)
src/pages/api/admin/course-image.ts         NEW  — cover image upload → R2
src/pages/api/admin/course-content.ts       EDIT — added batch drag-and-drop reorder
src/pages/api/courses/image/[...key].ts     NEW  — public image serving route
src/pages/api/courses/submit.ts             EDIT — reads course via the merge layer
src/pages/api/courses/pay.ts                EDIT — same
src/pages/api/courses/enroll.ts             EDIT — same
src/pages/api/courses/questions.ts          EDIT — same
src/pages/api/certificates/verify.ts        EDIT — same
src/layouts/DashboardLayout.astro           NEW  — stripped admin chrome
src/pages/dashboard/courses/index.astro     EDIT — redesigned course list + "New course"
src/pages/dashboard/courses/new.astro       NEW  — course creation form
src/pages/dashboard/courses/[slug].astro    EDIT — the two-pane Studio (the big one)
src/pages/courses/index.astro               EDIT — now SSR + reads the merge layer
src/pages/courses/[slug].astro              EDIT — reads the merge layer, fixed a render() edge case
src/pages/courses/[slug]/learn/[stepId].astro EDIT — reads the merge layer
public/admin/config.yml                     EDIT — removed the Decap "Courses" collection
```

## Setup steps (one-time)

1. **Create the R2 bucket for course images** (only needed if you want cover
   images — everything else works without it):
   ```
   npx wrangler r2 bucket create psychology-square-course-assets
   ```
   The binding is already wired up in `wrangler.jsonc`.

2. **Run the D1 migration** — this creates the `courses` table and copies
   your 3 existing courses' current values into it verbatim:
   ```
   npx wrangler d1 execute psychology-square-bookings --remote --file=./migrations-2026-08-course-entity.sql
   ```
   (Swap in your actual D1 database name if it's different — check
   `wrangler.jsonc` under `d1_databases` to confirm.)

3. **Deploy as usual** (`npm run deploy`). No new npm packages were added,
   so there's nothing to `npm install`.

4. Log into `/dashboard/courses` — you'll see your 3 existing courses
   there already, fully editable, plus a **+ New course** button.

## How the two systems coexist (so nothing breaks)

Your live site currently reads course metadata from
`src/content/courses/*.md` via Astro's content collections. That still
works exactly as it does today. The only change is that `src/lib/courses.ts`
now sits in front of it everywhere the site reads a course:

- If a course has a row in the new D1 `courses` table, that row wins for
  all metadata (title, price, quiz, etc).
- If it doesn't, the Decap markdown file is used, completely unchanged.
- The three existing courses are pre-loaded into D1 by the migration, so
  they're editable from day one — but their values are copied exactly,
  so the live site looks identical until you actually change something.
- A handful of very old courses without any modules yet still render
  through their original Decap `body` field as a single page (this was
  already true before my changes) — that keeps working too, since the
  merge layer keeps the original renderable entry around, only
  overriding the metadata fields you'd edit in the Studio.

## What I'd still recommend, next

- Once you're comfortable the new flow works, delete the 3 old `.md`
  files under `src/content/courses/` — they're inert once a course has a
  D1 row for everything the site reads, except that lingering legacy
  `body` fallback. If you want, I can also build a small "convert to
  modules" migrator so those 3 courses stop depending on their markdown
  file at all.
- The rich-text lesson editor is currently a plain textarea (matches
  your site's existing zero-framework style — no new dependencies to
  install/test). If you want real Markdown preview or a toolbar
  (bold/headings/lists) later, that's a contained addition to just the
  lesson editor panel in the Studio file.
