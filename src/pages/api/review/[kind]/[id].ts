import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  isReviewKind, verifyReviewToken, loadReviewItem, approveReviewItem,
  type ReviewItem, type ApproveOutcome,
} from '../../../../lib/paymentReview';

export const prerender = false;

// The page behind the "Review & approve" button in the admin notification
// emails (see src/lib/paymentReview.ts for the full picture).
//   GET  -> shows the submission + screenshot. Never changes anything, so
//           mail scanners that open every link can't approve by accident.
//   POST -> the Approve button. Same effect as approving on the dashboard.

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
};

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Karachi' }) + ' PKT';
}

type Banner = { tone: 'ok' | 'warn' | 'bad'; text: string };

function shell(title: string, inner: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${esc(title)} — The Psychology Square</title>
<style>
  body{margin:0;background:#F4F1EA;color:#131A22;font-family:Georgia,serif;}
  .wrap{max-width:560px;margin:0 auto;padding:32px 20px 48px;}
  .brand{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#C7A44A;font-weight:600;margin-bottom:20px;}
  h1{font-size:22px;margin:0 0 16px;}
  .card{background:#fff;border:1px solid rgba(19,26,34,.12);border-radius:4px;padding:20px;margin-bottom:16px;}
  dl{margin:0;display:grid;grid-template-columns:110px 1fr;gap:8px 12px;font-size:15px;line-height:1.5;}
  dt{color:#4B5760;} dd{margin:0;word-break:break-word;}
  .banner{border-radius:4px;padding:14px 16px;margin-bottom:16px;font-size:15px;line-height:1.5;}
  .ok{background:#E6F2E8;border:1px solid #9CC8A4;} .warn{background:#FFF6DD;border:1px solid #E2C877;} .bad{background:#FBE9E7;border:1px solid #E0A9A2;}
  img.shot{display:block;max-width:100%;height:auto;border:1px solid rgba(19,26,34,.12);border-radius:4px;}
  .btn{background:#C7A44A;color:#131A22;border:0;padding:14px 28px;border-radius:2px;font-weight:600;font-size:16px;font-family:inherit;cursor:pointer;}
  a{color:#0066cc;} .muted{font-size:13px;color:#4B5760;margin-top:16px;}
</style></head>
<body><div class="wrap"><div class="brand">The Psychology Square</div>${inner}</div></body></html>`;
  return new Response(html, { status, headers: PAGE_HEADERS });
}

function messagePage(title: string, text: string, status: number): Response {
  return shell(title, `<h1>${esc(title)}</h1><div class="banner bad">${text}</div>
    <p class="muted"><a href="/dashboard/">Open the dashboard</a></p>`, status);
}

function renderItem(item: ReviewItem, token: string, banner: Banner | null): Response {
  const enc = encodeURIComponent(item.id);
  const shotUrl = `/api/review/shot/${item.kind}/${enc}?t=${encodeURIComponent(token)}`;
  const reviewed = formatDate(item.reviewedAt);

  let statusBlock = '';
  if (banner) {
    statusBlock = `<div class="banner ${banner.tone}">${esc(banner.text)}</div>`;
  } else if (item.status === 'approved') {
    statusBlock = `<div class="banner ok">✓ Already approved${reviewed ? ` on ${esc(reviewed)}` : ''}. Nothing more to do.</div>`;
  } else if (item.status === 'declined') {
    statusBlock = `<div class="banner warn">This one was declined earlier${reviewed ? ` (${esc(reviewed)})` : ''}. To change that, use the dashboard.</div>`;
  }

  const canApprove = item.status === 'pending' && !banner;
  const form = canApprove
    ? `<form method="post" action="/api/review/${item.kind}/${enc}?t=${encodeURIComponent(token)}">
         <button class="btn" type="submit">Approve payment</button>
       </form>
       <p class="muted">Approving emails the client their confirmation, and updates the dashboard too.</p>`
    : '';

  const shot = item.screenshotKey
    ? `<div class="card"><a href="${shotUrl}" target="_blank" rel="noopener"><img class="shot" src="${shotUrl}" alt="Payment screenshot" /></a>
         <p class="muted" style="margin-bottom:0;"><a href="${shotUrl}" target="_blank" rel="noopener">Open screenshot full size</a></p></div>`
    : `<div class="banner warn">No screenshot is on file for this submission.</div>`;

  const rows = item.details.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  return shell(item.heading, `<h1>${esc(item.heading)}</h1>${statusBlock}
    <div class="card"><dl>${rows}</dl></div>${shot}${form}
    <p class="muted"><a href="/dashboard/">Open the dashboard</a></p>`);
}

function bannerFor(outcome: ApproveOutcome): Banner {
  switch (outcome) {
    case 'approved': return { tone: 'ok', text: '✓ Approved. The client has been emailed their confirmation and the dashboard is updated.' };
    case 'already': return { tone: 'ok', text: '✓ This was already approved (from the dashboard or an earlier click), so nothing changed and no second email was sent.' };
    case 'declined': return { tone: 'warn', text: 'This was declined earlier, so it was left as is. To change that, use the dashboard.' };
    default: return { tone: 'bad', text: 'Something went wrong, so nothing was changed. Please try from the dashboard.' };
  }
}

async function authorize(params: { kind?: string; id?: string }, url: URL) {
  const kind = params.kind;
  const id = params.id ?? '';
  const token = url.searchParams.get('t') ?? '';
  if (!isReviewKind(kind) || !id) return null;
  const ok = await verifyReviewToken(env?.ADMIN_SESSION_SECRET, kind, id, token);
  return ok ? { kind, id, token } : null;
}

export const GET: APIRoute = async ({ params, url }) => {
  const auth = await authorize(params, url);
  if (!auth) return messagePage('Link not valid', 'This review link is invalid or has expired. You can still review it from the dashboard.', 403);

  const item = await loadReviewItem(env, auth.kind, auth.id);
  if (!item) return messagePage('Not found', 'This submission no longer exists. It may have been deleted, or the person may have resubmitted (which creates a fresh notification email).', 404);
  return renderItem(item, auth.token, null);
};

export const POST: APIRoute = async ({ params, url }) => {
  const auth = await authorize(params, url);
  if (!auth) return messagePage('Link not valid', 'This review link is invalid or has expired. You can still approve it from the dashboard.', 403);

  const outcome = await approveReviewItem(env, auth.kind, auth.id, url.origin);
  if (outcome === 'notfound') return messagePage('Not found', 'This submission no longer exists.', 404);

  const item = await loadReviewItem(env, auth.kind, auth.id);
  if (!item) return messagePage('Not found', 'This submission no longer exists.', 404);
  return renderItem(item, auth.token, bannerFor(outcome));
};
