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
  args: { toEmail: string; link: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return { ok: false, error: 'Email is not configured yet (missing RESEND_API_KEY or EMAIL_FROM).' };
  }
  const html = emailShell(`
    <h1 style="font-size:22px;margin:0 0 16px;">View your certificates</h1>
    <p style="font-size:15px;line-height:1.6;">Click the button below to see every certificate you've earned with us. This link works once and expires in 15 minutes.</p>
    <p style="margin:28px 0;">
      <a href="${args.link}" style="background:#C7A44A;color:#131A22;text-decoration:none;padding:12px 24px;border-radius:2px;font-weight:600;display:inline-block;">View my certificates</a>
    </p>
    <p style="font-size:13px;color:#4B5760;">If you didn't request this, you can safely ignore this email.</p>
  `);
  return sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    to: args.toEmail,
    subject: 'Your certificates link — The Psychology Square',
    html,
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SERVICE_LABELS: Record<string, string> = { individual: 'Individual Therapy', couples: 'Couples Therapy' };
const MODE_LABELS: Record<string, string> = { online: 'Online', in_person: 'In person' };
const CLINICIAN_LABELS: Record<string, string> = { sohail: 'Muhammad Sohail', sehar: 'Sehar Waheed' };

function serviceLabel(service: string): string {
  return SERVICE_LABELS[service] || service;
}
function modeLabel(mode: string): string {
  return MODE_LABELS[mode] || mode;
}
function clinicianLabel(clinician: string): string {
  return CLINICIAN_LABELS[clinician] || clinician;
}

// Sent to the practice inbox the moment a client submits a booking, so
// clinicians/admin don't have to keep the dashboard open to notice it.
export async function sendNewBookingAdminEmail(
  env: { RESEND_API_KEY?: string; EMAIL_FROM?: string; BOOKING_ADMIN_EMAIL?: string },
  args: {
    reference: string; clientName: string; contact: string; service: string; mode: string;
    clinician: string; preferredTime: string; amountPkr: number; paymentMethod: string; notes?: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM || !env.BOOKING_ADMIN_EMAIL) {
    return { ok: false, error: 'Email is not configured yet (missing RESEND_API_KEY, EMAIL_FROM, or BOOKING_ADMIN_EMAIL).' };
  }
  const html = emailShell(`
    <h1 style="font-size:22px;margin:0 0 16px;">New booking — ${escapeHtml(args.reference)}</h1>
    <p style="font-size:15px;line-height:1.6;">A new session request just came in and is waiting for review.</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
      <tr><td style="padding:6px 0;color:#4B5760;width:140px;">Client</td><td style="padding:6px 0;">${escapeHtml(args.clientName)}</td></tr>
      <tr><td style="padding:6px 0;color:#4B5760;">Contact</td><td style="padding:6px 0;">${escapeHtml(args.contact)}</td></tr>
      <tr><td style="padding:6px 0;color:#4B5760;">Service</td><td style="padding:6px 0;">${escapeHtml(serviceLabel(args.service))}</td></tr>
      <tr><td style="padding:6px 0;color:#4B5760;">Format</td><td style="padding:6px 0;">${escapeHtml(modeLabel(args.mode))}</td></tr>
      <tr><td style="padding:6px 0;color:#4B5760;">Clinician</td><td style="padding:6px 0;">${escapeHtml(clinicianLabel(args.clinician))}</td></tr>
      <tr><td style="padding:6px 0;color:#4B5760;">Requested time</td><td style="padding:6px 0;">${escapeHtml(args.preferredTime)}</td></tr>
      <tr><td style="padding:6px 0;color:#4B5760;">Amount</td><td style="padding:6px 0;">PKR ${args.amountPkr.toLocaleString('en-US')} via ${escapeHtml(args.paymentMethod)}</td></tr>
      ${args.notes ? `<tr><td style="padding:6px 0;color:#4B5760;">Notes</td><td style="padding:6px 0;">${escapeHtml(args.notes)}</td></tr>` : ''}
    </table>
    <p style="margin:28px 0;">
      <a href="https://thepsychologysquare.com/dashboard" style="background:#C7A44A;color:#131A22;text-decoration:none;padding:12px 24px;border-radius:2px;font-weight:600;display:inline-block;">Review in dashboard</a>
    </p>
    <p style="font-size:13px;color:#4B5760;">Confirming or declining this booking in the dashboard will automatically email the client.</p>
  `);
  return sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    to: env.BOOKING_ADMIN_EMAIL,
    subject: `New booking (${args.reference}) — ${args.clientName}`,
    html,
  });
}

// Sent to the client the moment a therapist/admin confirms or declines
// their booking from the dashboard. Silently skipped if the contact field
// they gave at booking time was a phone number rather than an email.
export async function sendBookingStatusEmail(
  env: { RESEND_API_KEY?: string; EMAIL_FROM?: string },
  args: {
    toContact: string; toName: string; status: 'confirmed' | 'declined'; service: string;
    clinician: string; mode: string; preferredTime: string; reference: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  if (!EMAIL_RE.test(args.toContact)) {
    return { ok: false, error: 'Contact on file is not an email address — skipped.' };
  }
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return { ok: false, error: 'Email is not configured yet (missing RESEND_API_KEY or EMAIL_FROM).' };
  }

  const html = args.status === 'confirmed'
    ? emailShell(`
        <h1 style="font-size:22px;margin:0 0 16px;">You're confirmed, ${escapeHtml(args.toName)}!</h1>
        <p style="font-size:15px;line-height:1.6;">Your ${escapeHtml(modeLabel(args.mode)).toLowerCase()} ${escapeHtml(serviceLabel(args.service)).toLowerCase()} session with ${escapeHtml(clinicianLabel(args.clinician))} is confirmed.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
          <tr><td style="padding:6px 0;color:#4B5760;width:140px;">Reference</td><td style="padding:6px 0;">${escapeHtml(args.reference)}</td></tr>
          <tr><td style="padding:6px 0;color:#4B5760;">Time</td><td style="padding:6px 0;">${escapeHtml(args.preferredTime)}</td></tr>
          <tr><td style="padding:6px 0;color:#4B5760;">Format</td><td style="padding:6px 0;">${escapeHtml(modeLabel(args.mode))}</td></tr>
        </table>
        ${args.mode === 'in_person'
          ? `<p style="font-size:13px;color:#4B5760;">This is an in-person slot at our Johar Town, Lahore office. If anything changes on our end, we'll reach out to reschedule you to the next available in-person time.</p>`
          : `<p style="font-size:13px;color:#4B5760;">We'll send the video call link ahead of your session.</p>`}
      `)
    : emailShell(`
        <h1 style="font-size:22px;margin:0 0 16px;">About your booking, ${escapeHtml(args.toName)}</h1>
        <p style="font-size:15px;line-height:1.6;">We're not able to confirm your requested session (reference ${escapeHtml(args.reference)}) at ${escapeHtml(args.preferredTime)}. This is usually a scheduling or payment issue rather than anything on your end.</p>
        <p style="margin:28px 0;">
          <a href="https://thepsychologysquare.com/book" style="background:#C7A44A;color:#131A22;text-decoration:none;padding:12px 24px;border-radius:2px;font-weight:600;display:inline-block;">Pick another time</a>
        </p>
        <p style="font-size:13px;color:#4B5760;">If you have questions, just reply to this email and we'll help you find a time that works.</p>
      `);

  return sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    to: args.toContact,
    subject: args.status === 'confirmed'
      ? `Your session is confirmed — ${args.reference}`
      : `About your booking — ${args.reference}`,
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
