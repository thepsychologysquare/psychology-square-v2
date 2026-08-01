// Transactional email via Resend (https://resend.com). Workers can't send
// email natively, and Resend's free tier (3,000/mo, 100/day) is plenty for
// certificate + magic-link volume here.
//
// Requires two things set on the Worker:
//   - RESEND_API_KEY   (secret)   — from the Resend dashboard
//   - EMAIL_FROM       (var)      — e.g. "The Psychology Square <certificates@thepsychologysquare.com>"
//                                   Must be an address on a domain you've verified in Resend.
//                                   Until a domain is verified, Resend only allows sending
//                                   to your own account email — fine for testing, not for real users.

interface SendEmailArgs {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
}

async function sendEmail({ apiKey, from, to, subject, html }: SendEmailArgs): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `Resend ${res.status}: ${body}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown email error' };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function emailShell(bodyHtml: string): string {
  return `
  <div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#131A22;">
    <div style="font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:#C7A44A;font-weight:600;margin-bottom:24px;">
      The Psychology Square
    </div>
    ${bodyHtml}
    <div style="margin-top:40px;padding-top:16px;border-top:1px solid rgba(19,26,34,0.12);font-size:12px;color:#4B5760;">
      The Psychology Square — Johar Town, Lahore, Pakistan
    </div>
  </div>`;
}

export async function sendMagicLinkEmail(
  env: { RESEND_API_KEY?: string; EMAIL_FROM?: string },
  args: { toEmail: string; link: string; purpose?: 'enroll' | 'view-certificates'; courseTitle?: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return { ok: false, error: 'Email is not configured yet (missing RESEND_API_KEY or EMAIL_FROM).' };
  }

  const isEnroll = args.purpose === 'enroll';
  const heading = isEnroll ? 'Confirm your enrollment' : 'View your certificates';
  const body = isEnroll
    ? `Click the button below to confirm your email and finish enrolling${args.courseTitle ? ` in <strong>${args.courseTitle}</strong>` : ''}. This link works once and expires in 15 minutes.`
    : `Click the button below to see every certificate you've earned with us. This link works once and expires in 15 minutes.`;
  const buttonText = isEnroll ? 'Confirm enrollment' : 'View my certificates';
  const subject = isEnroll ? 'Confirm your course enrollment — The Psychology Square' : 'Your certificates link — The Psychology Square';

  const html = emailShell(`
    <h1 style="font-size:22px;margin:0 0 16px;">${heading}</h1>
    <p style="font-size:15px;line-height:1.6;">${body}</p>
    <p style="margin:28px 0;">
      <a href="${args.link}" style="background:#C7A44A;color:#131A22;text-decoration:none;padding:12px 24px;border-radius:2px;font-weight:600;display:inline-block;">${buttonText}</a>
    </p>
    <p style="font-size:13px;color:#4B5760;">If you didn't request this, you can safely ignore this email.</p>
  `);
  return sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    to: args.toEmail,
    subject,
    html,
  });
}

export async function sendCertificateEmail(
  env: { RESEND_API_KEY?: string; EMAIL_FROM?: string },
  args: { toEmail: string; toName: string; courseTitle: string; certUrl: string; certificateId: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return { ok: false, error: 'Email is not configured yet (missing RESEND_API_KEY or EMAIL_FROM).' };
  }
  const html = emailShell(`
    <h1 style="font-size:22px;margin:0 0 16px;">Congratulations, ${escapeHtml(args.toName)}!</h1>
    <p style="font-size:15px;line-height:1.6;">You've completed <strong>${escapeHtml(args.courseTitle)}</strong> and earned your certificate.</p>
    <p style="margin:28px 0;">
      <a href="${args.certUrl}" style="background:#C7A44A;color:#131A22;text-decoration:none;padding:12px 24px;border-radius:2px;font-weight:600;display:inline-block;">View your certificate</a>
    </p>
    <p style="font-size:13px;color:#4B5760;">Certificate ID: ${escapeHtml(args.certificateId)}<br/>This link is permanent and publicly verifiable — anyone with it can confirm the certificate is genuine.</p>
  `);
  return sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    to: args.toEmail,
    subject: `Your certificate for ${args.courseTitle}`,
    html,
  });
}
