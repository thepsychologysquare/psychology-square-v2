import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getSession } from '../../../lib/adminAuth';

export const prerender = false;

const WEEKS_AHEAD = 8; // how far out the rolling schedule keeps itself generated

function canManage(role: string, clinician: string) {
  return role === 'admin' || role === clinician;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timesInRange(start: string, end: string, stepMin: number): string[] {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let cur = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const out: string[] = [];
  while (cur < endMin) {
    out.push(`${pad(Math.floor(cur / 60))}:${pad(cur % 60)}`);
    cur += stepMin;
  }
  return out;
}

function datesForDays(days: number[], weeksAhead: number): string[] {
  const out: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const totalDays = weeksAhead * 7;
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    if (days.includes(d.getDay())) out.push(toDateStr(d));
  }
  return out;
}

// Brings the next WEEKS_AHEAD weeks of open slots in line with a clinician's
// saved weekly template: adds missing open slots that match, and removes
// open (never-booked) slots that no longer match the template or fall on an
// exception date. Booked slots are never touched.
async function syncTemplate(clinician: string, days: number[], startTime: string, endTime: string, slotMinutes: number) {
  const exRes = await env.DB.prepare(`SELECT date FROM availability_exceptions WHERE clinician = ?`)
    .bind(clinician).all<{ date: string }>();
  const exceptionDates = new Set((exRes.results || []).map((r) => r.date));

  const dates = datesForDays(days, WEEKS_AHEAD).filter((d) => !exceptionDates.has(d));
  const times = timesInRange(startTime, endTime, slotMinutes);
  const dateSet = new Set(dates);
  const timeSet = new Set(times);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowStart = toDateStr(today);
  const windowEndDate = new Date(today);
  windowEndDate.setDate(windowEndDate.getDate() + WEEKS_AHEAD * 7);
  const windowEnd = toDateStr(windowEndDate);

  const statements = [];

  for (const date of dates) {
    for (const time of times) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO availability_slots (clinician, date, time, status)
           SELECT ?, ?, ?, 'open'
           WHERE NOT EXISTS (
             SELECT 1 FROM availability_slots WHERE clinician = ? AND date = ? AND time = ?
           )`
        ).bind(clinician, date, time, clinician, date, time)
      );
    }
  }

  const existing = await env.DB.prepare(
    `SELECT id, date, time, status FROM availability_slots WHERE clinician = ? AND date >= ? AND date < ?`
  ).bind(clinician, windowStart, windowEnd).all<{ id: number; date: string; time: string; status: string }>();

  for (const slot of existing.results || []) {
    if (slot.status === 'booked') continue;
    const matches = dateSet.has(slot.date) && timeSet.has(slot.time) && !exceptionDates.has(slot.date);
    if (!matches) {
      statements.push(env.DB.prepare(`DELETE FROM availability_slots WHERE id = ?`).bind(slot.id));
    }
  }

  if (statements.length) await env.DB.batch(statements);
}

async function getTemplate(clinician: string) {
  const t = await env.DB.prepare(
    `SELECT days, start_time, end_time, slot_minutes FROM weekly_templates WHERE clinician = ?`
  ).bind(clinician).first<{ days: string; start_time: string; end_time: string; slot_minutes: number }>();
  if (!t) return null;
  return { days: JSON.parse(t.days) as number[], start_time: t.start_time, end_time: t.end_time, slot_minutes: t.slot_minutes };
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const requested = url.searchParams.get('clinician');
  const clinician = session.role === 'admin' ? requested : session.role;

  let template = null;
  let exceptions: string[] = [];

  if (clinician) {
    template = await getTemplate(clinician);
    // Keep the rolling window topped up every time the dashboard checks in —
    // this is what makes "set it once" actually true going forward.
    if (template) {
      await syncTemplate(clinician, template.days, template.start_time, template.end_time, template.slot_minutes);
    }
    const exRes = await env.DB.prepare(`SELECT date FROM availability_exceptions WHERE clinician = ?`)
      .bind(clinician).all<{ date: string }>();
    exceptions = (exRes.results || []).map((r) => r.date);
  }

  const query = clinician
    ? `SELECT id, clinician, date, time, status FROM availability_slots WHERE clinician = ? ORDER BY date, time`
    : `SELECT id, clinician, date, time, status FROM availability_slots ORDER BY date, time`;
  const stmt = clinician ? env.DB.prepare(query).bind(clinician) : env.DB.prepare(query);
  const { results } = await stmt.all();

  return new Response(JSON.stringify({ slots: results, template, exceptions }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

// Two supported bodies:
//  A) Weekly template (the normal path now):
//     { mode: 'generate', clinician, days: [0..6], start_time, end_time, slot_minutes }
//  B) Legacy one-off bulk add, kept for compatibility:
//     { clinician, dates: [...], times: [...] }
export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const body = await request.json().catch(() => null);
  const clinician = body?.clinician;

  if (!canManage(session.role, clinician)) {
    return new Response(JSON.stringify({ error: 'Not authorized for that clinician.' }), { status: 403 });
  }

  if (body?.mode === 'generate') {
    const days: number[] = Array.isArray(body?.days)
      ? body.days.filter((d: any) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [];
    const startTime = typeof body?.start_time === 'string' ? body.start_time : '';
    const endTime = typeof body?.end_time === 'string' ? body.end_time : '';
    const slotMinutes = Number.isInteger(body?.slot_minutes) ? body.slot_minutes : 60;

    if (!days.length) {
      return new Response(JSON.stringify({ error: 'Pick at least one working day.' }), { status: 400 });
    }
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || startTime >= endTime) {
      return new Response(JSON.stringify({ error: 'Pick a valid start and end time.' }), { status: 400 });
    }
    if (![15, 30, 45, 60, 90, 120].includes(slotMinutes)) {
      return new Response(JSON.stringify({ error: 'Invalid session length.' }), { status: 400 });
    }

    await env.DB.prepare(
      `INSERT INTO weekly_templates (clinician, days, start_time, end_time, slot_minutes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(clinician) DO UPDATE SET
         days = excluded.days, start_time = excluded.start_time,
         end_time = excluded.end_time, slot_minutes = excluded.slot_minutes, updated_at = excluded.updated_at`
    ).bind(clinician, JSON.stringify(days), startTime, endTime, slotMinutes, new Date().toISOString()).run();

    await syncTemplate(clinician, days, startTime, endTime, slotMinutes);

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // Legacy bulk add (manual dates/times), kept working in case it's still used anywhere.
  const dates: string[] = Array.isArray(body?.dates) ? body.dates : [];
  const times: string[] = Array.isArray(body?.times) ? body.times : [];
  if (!dates.length || !times.length) {
    return new Response(JSON.stringify({ error: 'Pick at least one date and one time.' }), { status: 400 });
  }
  const statements = [];
  for (const date of dates.slice(0, 60)) {
    for (const time of times.slice(0, 20)) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO availability_slots (clinician, date, time, status)
           SELECT ?, ?, ?, 'open'
           WHERE NOT EXISTS (
             SELECT 1 FROM availability_slots WHERE clinician = ? AND date = ? AND time = ?
           )`
        ).bind(clinician, date, time, clinician, date, time)
      );
    }
  }
  await env.DB.batch(statements);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};

// Bulk exclude/include — used for "exclude this week" and multi-day selection:
//   { mode: 'exclude', clinician, dates: [...] }  -- mark all given dates off
//   { mode: 'include', clinician, dates: [...] }  -- undo the above
export const PUT: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const body = await request.json().catch(() => null);
  const clinician = body?.clinician;
  const mode = body?.mode;
  const dates: string[] = Array.isArray(body?.dates)
    ? body.dates.filter((d: any) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
    : [];

  if (!canManage(session.role, clinician)) {
    return new Response(JSON.stringify({ error: 'Not authorized.' }), { status: 403 });
  }
  if ((mode !== 'exclude' && mode !== 'include') || !dates.length) {
    return new Response(JSON.stringify({ error: 'Missing dates.' }), { status: 400 });
  }

  const statements = [];
  if (mode === 'exclude') {
    for (const date of dates) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO availability_exceptions (clinician, date) VALUES (?, ?)
           ON CONFLICT(clinician, date) DO NOTHING`
        ).bind(clinician, date)
      );
      statements.push(
        env.DB.prepare(
          `DELETE FROM availability_slots WHERE clinician = ? AND date = ? AND status != 'booked'`
        ).bind(clinician, date)
      );
    }
  } else {
    for (const date of dates) {
      statements.push(
        env.DB.prepare(`DELETE FROM availability_exceptions WHERE clinician = ? AND date = ?`).bind(clinician, date)
      );
    }
  }
  if (statements.length) await env.DB.batch(statements);

  if (mode === 'include') {
    const template = await getTemplate(clinician);
    if (template) {
      await syncTemplate(clinician, template.days, template.start_time, template.end_time, template.slot_minutes);
    }
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};

// Two supported uses:
//  A) Remove a single slot:               ?id=123
//  B) Mark an entire date off (exception): ?clinician=sohail&date=2026-08-10
export const DELETE: APIRoute = async ({ request, url }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const id = url.searchParams.get('id');
  const clinicianParam = url.searchParams.get('clinician');
  const dateParam = url.searchParams.get('date');

  if (!id && clinicianParam && dateParam) {
    if (!canManage(session.role, clinicianParam)) {
      return new Response(JSON.stringify({ error: 'Not authorized.' }), { status: 403 });
    }
    await env.DB.prepare(
      `INSERT INTO availability_exceptions (clinician, date) VALUES (?, ?)
       ON CONFLICT(clinician, date) DO NOTHING`
    ).bind(clinicianParam, dateParam).run();
    await env.DB.prepare(
      `DELETE FROM availability_slots WHERE clinician = ? AND date = ? AND status != 'booked'`
    ).bind(clinicianParam, dateParam).run();
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  if (!id) return new Response(JSON.stringify({ error: 'Missing id.' }), { status: 400 });

  const slot = await env.DB.prepare(`SELECT clinician, status FROM availability_slots WHERE id = ?`)
    .bind(id).first<{ clinician: string; status: string }>();
  if (!slot) return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 });
  if (!canManage(session.role, slot.clinician)) {
    return new Response(JSON.stringify({ error: 'Not authorized.' }), { status: 403 });
  }
  if (slot.status === 'booked') {
    return new Response(JSON.stringify({ error: 'Cannot remove a slot that has already been booked.' }), { status: 400 });
  }

  await env.DB.prepare(`DELETE FROM availability_slots WHERE id = ?`).bind(id).run();
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

// Undo a day-off exception: { clinician, date }
export const PATCH: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const body = await request.json().catch(() => null);
  const clinician = body?.clinician;
  const date = body?.date;

  if (!canManage(session.role, clinician)) {
    return new Response(JSON.stringify({ error: 'Not authorized.' }), { status: 403 });
  }
  if (!clinician || !date) {
    return new Response(JSON.stringify({ error: 'Missing clinician or date.' }), { status: 400 });
  }

  await env.DB.prepare(`DELETE FROM availability_exceptions WHERE clinician = ? AND date = ?`)
    .bind(clinician, date).run();

  const template = await getTemplate(clinician);
  if (template) {
    await syncTemplate(clinician, template.days, template.start_time, template.end_time, template.slot_minutes);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};
