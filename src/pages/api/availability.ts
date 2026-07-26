import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const clinician = url.searchParams.get('clinician'); // 'sohail' | 'sehar' | null (=both)

  const query = clinician
    ? `SELECT id, clinician, date, time FROM availability_slots
       WHERE status = 'open' AND clinician = ? AND date >= date('now')
       ORDER BY date, time LIMIT 300`
    : `SELECT id, clinician, date, time FROM availability_slots
       WHERE status = 'open' AND date >= date('now')
       ORDER BY date, time LIMIT 300`;

  const stmt = clinician ? env.DB.prepare(query).bind(clinician) : env.DB.prepare(query);
  const { results } = await stmt.all();

  return new Response(JSON.stringify({ slots: results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
