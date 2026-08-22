export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { importCourse, type CourseImportPayload } from '../../../lib/courseImport';

// Separate from the /api/admin/* routes on purpose: those authenticate the
// human dashboard via a signed session cookie (see adminAuth.ts), which an
// n8n HTTP Request node can't hold onto sensibly. This route instead checks
// a static bearer token, the same way the Github node in your n8n workflow
// authenticates with a personal access token. Set it once with:
//
//   npx wrangler secret put AUTOMATION_API_KEY
//
// then in n8n, add an HTTP Header Auth credential: header name
// "Authorization", value "Bearer <the same token>".
function isAuthorized(request: Request): boolean {
  const expected = env?.AUTOMATION_API_KEY;
  if (!expected) return false; // refuse everything until the secret is actually set
  const header = request.headers.get('authorization') || '';
  return header === `Bearer ${expected}`;
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthorized(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  let payload: CourseImportPayload;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  try {
    const result = await importCourse(env, payload);
    return new Response(JSON.stringify(result), { status: 201, headers: { 'content-type': 'application/json' } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Import failed' }), { status: 400 });
  }
};
