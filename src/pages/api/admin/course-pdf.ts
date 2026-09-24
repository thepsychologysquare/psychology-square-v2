export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getSession } from '../../../lib/adminAuth';

const MAX_BYTES = 25 * 1024 * 1024; // 25MB

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  if (!env?.COURSE_ASSETS) {
    return new Response(
      JSON.stringify({ error: 'File storage isn\u2019t configured yet (COURSE_ASSETS R2 bucket missing).' }),
      { status: 500 }
    );
  }

  const form = await request.formData();
  const file = form.get('pdf');
  if (!(file instanceof File)) return new Response(JSON.stringify({ error: 'No PDF provided' }), { status: 400 });
  if (file.type !== 'application/pdf') {
    return new Response(JSON.stringify({ error: 'File must be a PDF' }), { status: 400 });
  }
  if (file.size > MAX_BYTES) return new Response(JSON.stringify({ error: 'PDF must be under 25MB' }), { status: 400 });

  const key = `courses/pdfs/${crypto.randomUUID()}.pdf`;

  try {
    await env.COURSE_ASSETS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: 'application/pdf' } });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: `Could not save the PDF to storage: ${err?.message || err}` }),
      { status: 500 }
    );
  }

  // Same belt-and-suspenders check as the image upload path: confirm the
  // object actually persisted before handing back a URL that gets saved
  // to D1 -- otherwise a failed put() could silently save a dead link.
  try {
    const verify = await env.COURSE_ASSETS.head(key);
    if (!verify) {
      return new Response(
        JSON.stringify({ error: 'Upload did not persist to storage. Please try again.' }),
        { status: 500 }
      );
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: `Could not verify the upload: ${err?.message || err}` }),
      { status: 500 }
    );
  }

  return new Response(JSON.stringify({ url: `/api/courses/asset/${key}` }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
};
