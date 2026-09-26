// Transactional email via Resend (https://resend.com). Workers can't send
// email natively. This module is used ONLY for therapy booking emails and
// workshop payment/enrollment emails — low, predictable volume that
// comfortably fits Resend's free tier. Magic-link, certificate, and paid
// course payment/enrollment emails were moved to Brevo (see
// src/lib/email-brevo.ts) to stay within Resend's cap as course volume
// grows; this file is intentionally self-contained and shares no sending
// logic with that module.
//
// Requires two things set on the Worker:
//   - RESEND_API_KEY   (secret)   — from the Resend dashboard
//   - EMAIL_FROM       (var)      — e.g. "The Psychology Square <certificates@thepsychologysquare.com>"
//                                   Must be an address on a domain you've verified in Resend.
//                                   Until a domain is verified, Resend only allows sending
//                                   to your own account email — fine for testing, not for real users.

interface EmailAttachment {
  filename: string;
  content: string; // base64-encoded
}

interface SendEmailArgs {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}

async function sendEmail({ apiKey, from, to, subject, html, attachments }: SendEmailArgs): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html, ...(attachments?.length ? { attachments } : {}) }),
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

const CLINICIAN_NAMES: Record<string, string> = { sohail: 'Muhammad Sohail', sehar: 'Sehar Waheed' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function sendBookingStatusEmail(
  env: { RESEND_API_KEY?: string; EMAIL_FROM?: string },
  args: {
    toEmail: string; toName: string; status: 'confirmed' | 'declined';
    service: string; clinician: string; mode: string; preferredTime: string; reference: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return { ok: false, error: 'Email is not configured yet (missing RESEND_API_KEY or EMAIL_FROM).' };
  }
  // The booking form collects email as its own mandatory field, but this is
  // kept as a defensive check in case of malformed/legacy data.
  if (!EMAIL_RE.test(args.toEmail)) {
    return { ok: false, error: 'Contact on file is not a valid email address.' };
  }

  const clinicianName = CLINICIAN_NAMES[args.clinician] || args.clinician;
  const serviceLabel = args.service === 'couples' ? 'Couples Therapy' : 'Individual Therapy';
  const isConfirmed = args.status === 'confirmed';

  const heading = isConfirmed ? 'Your session is confirmed' : 'About your booking';
  const body = isConfirmed
    ? `Your ${serviceLabel} session with ${escapeHtml(clinicianName)} (${escapeHtml(args.mode)}) for ${escapeHtml(args.preferredTime)} has been confirmed. We look forward to seeing you.`
    : `Unfortunately we're unable to confirm your requested ${serviceLabel} session with ${escapeHtml(clinicianName)} for ${escapeHtml(args.preferredTime)}. Please get in touch or rebook for another time that works.`;

  const html = emailShell(`
    <h1 style="font-size:22px;margin:0 0 16px;">${heading}</h1>
    <p style="font-size:15px;line-height:1.6;">Hi ${escapeHtml(args.toName)},</p>
    <p style="font-size:15px;line-height:1.6;">${body}</p>
    <p style="font-size:13px;color:#4B5760;margin-top:24px;">Booking reference: ${escapeHtml(args.reference)}</p>
  `);

  return sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    to: args.toEmail,
    subject: isConfirmed ? 'Your session is confirmed — The Psychology Square' : 'About your booking — The Psychology Square',
    html,
  });
}

export async function sendNewBookingAdminEmail(
  env: { RESEND_API_KEY?: string; EMAIL_FROM?: string; ADMIN_EMAIL?: string },
  args: {
    reference: string;
    clientName: string;
    email: string;
    phone: string;
    service: string;
    mode: string;
    clinician: string;
    preferredTime: string;
    amountPkr: number;
    paymentMethod: string;
    notes?: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return { ok: false, error: 'Email is not configured yet.' };
  }

  const adminAddress = env.ADMIN_EMAIL || env.EMAIL_FROM;

  const html = emailShell(`
    <h1 style="font-size:20px;margin:0 0 16px;">New Booking Submission</h1>
    <p style="font-size:14px;line-height:1.5;">A new session booking has been submitted and requires review:</p>
    <ul style="font-size:14px;line-height:1.6;padding-left:20px;">
      <li><strong>Reference:</strong> ${escapeHtml(args.reference)}</li>
      <li><strong>Client:</strong> ${escapeHtml(args.clientName)}</li>
      <li><strong>Email:</strong> ${escapeHtml(args.email)}</li>
      <li><strong>Phone:</strong> ${escapeHtml(args.phone)}</li>
      <li><strong>Service:</strong> ${escapeHtml(args.service)} (${escapeHtml(args.mode)})</li>
      <li><strong>Clinician:</strong> ${escapeHtml(args.clinician)}</li>
      <li><strong>Time:</strong> ${escapeHtml(args.preferredTime)}</li>
      <li><strong>Amount:</strong> PKR ${args.amountPkr} via ${escapeHtml(args.paymentMethod)}</li>
      ${args.notes ? `<li><strong>Notes:</strong> ${escapeHtml(args.notes)}</li>` : ''}
    </ul>
  `);

  return sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    to: adminAddress,
    subject: `[New Booking] ${args.reference} - ${args.clientName}`,
    html,
  });
}

// ---------- Workshops: payment proof -> admin review -> group confirms ----------
// Kept on Resend alongside bookings (low volume — workshops stay paid/manual,
// so there's no need to route them through the higher-cap Brevo flow).
// Same shape as the booking/course-payment emails above, plus one new one
// (sendWorkshopConfirmedEmail) that fires once for every approved
// enrollee the moment an admin locks in the date + Meet link.

export async function sendWorkshopEnrollmentReceivedEmail(
  env: { RESEND_API_KEY?: string; EMAIL_FROM?: string },
  args: { toEmail: string; toName: string; workshopTitle: string; reference: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return { ok: false, error: 'Email is not configured yet.' };
  }
  if (!EMAIL_RE.test(args.toEmail)) {
    return { ok: false, error: 'Contact on file is not a valid email address.' };
  }
  const html = emailShell(`
    <h1 style="font-size:22px;margin:0 0 16px;">We received your workshop signup</h1>
    <p style="font-size:15px;line-height:1.6;">Hi ${escapeHtml(args.toName)},</p>
    <p style="font-size:15px;line-height:1.6;">
    Thank you for signing up for <strong>${escapeHtml(args.workshopTitle)}</strong>. We've received your screenshot
    submission. Our team is reveiwing it at the moment. We'll confirm your seat, typically within a few hours. The workshop will be conducted within one week of your submission -- we'll email you the date, time, and Google Meet link the moment it's locked in. If you have any questions in the meantime, feel free to reach out to us at <a href="mailto:info@thepsychologysquare.com" style="color: #0066cc; text-decoration: underline;">info@thepsychologysquare.com</a>.
</p>
    <p style="font-size:13px;color:#4B5760;margin-top:24px;">Reference: ${escapeHtml(args.reference)}</p>
  `);
  return sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    to: args.toEmail,
    subject: `We've received your signup — ${args.workshopTitle}`,
    html,
  });
}

export async function sendNewWorkshopEnrollmentAdminEmail(
  env: { RESEND_API_KEY?: string; EMAIL_FROM?: string; ADMIN_EMAIL?: string },
  args: {
    reference: string; name: string; email: string; phone: string; workshopTitle: string;
    amountPkr: number; paymentMethod: string; notes?: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return { ok: false, error: 'Email is not configured yet.' };
  }
  const adminAddress = env.ADMIN_EMAIL || env.EMAIL_FROM;
  const html = emailShell(`
    <h1 style="font-size:20px;margin:0 0 16px;">New Workshop Signup</h1>
    <p style="font-size:14px;line-height:1.5;">A new workshop payment has been submitted and requires review:</p>
    <ul style="font-size:14px;line-height:1.6;padding-left:20px;">
      <li><strong>Reference:</strong> ${escapeHtml(args.reference)}</li>
      <li><strong>Workshop:</strong> ${escapeHtml(args.workshopTitle)}</li>
      <li><strong>Name:</strong> ${escapeHtml(args.name)}</li>
      <li><strong>Email:</strong> ${escapeHtml(args.email)}</li>
      <li><strong>Phone:</strong> ${escapeHtml(args.phone)}</li>
      <li><strong>Amount:</strong> PKR ${args.amountPkr} via ${escapeHtml(args.paymentMethod)}</li>
      ${args.notes ? `<li><strong>Notes:</strong> ${escapeHtml(args.notes)}</li>` : ''}
    </ul>
    <p style="font-size:13px;color:#4B5760;">Review it from the workshop's page in the dashboard.</p>
  `);
  return sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    to: adminAddress,
    subject: `[New Workshop Signup] ${args.workshopTitle} - ${args.name}`,
    html,
  });
}

export async function sendWorkshopEnrollmentStatusEmail(
  env: { RESEND_API_KEY?: string; EMAIL_FROM?: string },
  args: { toEmail: string; toName: string; workshopTitle: string; status: 'active' | 'declined' }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return { ok: false, error: 'Email is not configured yet.' };
  }
  if (!EMAIL_RE.test(args.toEmail)) {
    return { ok: false, error: 'Contact on file is not a valid email address.' };
  }
  const isConfirmed = args.status === 'active';
  const heading = isConfirmed ? 'Your seat is confirmed' : 'About your workshop payment';
  const body = isConfirmed
    ? `Your payment for <strong>${escapeHtml(args.workshopTitle)}</strong> has been confirmed and your seat is reserved. We'll email you the date, time, and Google Meet link once enough people have joined and the workshop is locked in.`
    : `We couldn't confirm your payment for <strong>${escapeHtml(args.workshopTitle)}</strong> — usually this means the either the screenshot was not genuine, vauge, or unclear. Please resubmit with a clearer screenshot, or get in touch with us directly at <a href="mailto:info@thepsychologysquare.com" style="color: #0066cc; text-decoration: underline;">info@thepsychologysquare.com</a>`;
  const html = emailShell(`
    <h1 style="font-size:22px;margin:0 0 16px;">${heading}</h1>
    <p style="font-size:15px;line-height:1.6;">Hi ${escapeHtml(args.toName)},</p>
    <p style="font-size:15px;line-height:1.6;">${body}</p>
  `);
  return sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    to: args.toEmail,
    subject: isConfirmed ? `Your seat is confirmed — ${args.workshopTitle}` : `About your payment — ${args.workshopTitle}`,
    html,
  });
}

export async function sendWorkshopConfirmedEmail(
  env: { RESEND_API_KEY?: string; EMAIL_FROM?: string },
  args: { toEmail: string; toName: string; workshopTitle: string; scheduledAt: string; meetLink: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return { ok: false, error: 'Email is not configured yet.' };
  }
  if (!EMAIL_RE.test(args.toEmail)) {
    return { ok: false, error: 'Contact on file is not a valid email address.' };
  }
  const html = emailShell(`
    <h1 style="font-size:22px;margin:0 0 16px;">We're on — the workshop is confirmed</h1>
    <p style="font-size:15px;line-height:1.6;">Hi ${escapeHtml(args.toName)},</p>
    <p style="font-size:15px;line-height:1.6;">
      Enough people have joined <strong>${escapeHtml(args.workshopTitle)}</strong>, so it's officially happening.
    </p>
    <p style="font-size:15px;line-height:1.6;"><strong>When:</strong> ${escapeHtml(args.scheduledAt)}</p>
    <p style="margin:28px 0;">
      <a href="${args.meetLink}" style="background:#C7A44A;color:#131A22;text-decoration:none;padding:12px 24px;border-radius:2px;font-weight:600;display:inline-block;">Join on Google Meet</a>
    </p>
    <p style="font-size:13px;color:#4B5760;">Save this email — you'll need the link above at the scheduled time.</p>
  `);
  return sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    to: args.toEmail,
    subject: `Confirmed: ${args.workshopTitle} — ${args.scheduledAt}`,
    html,
  });
}

export async function sendBookingReceivedClientEmail(
  env: { RESEND_API_KEY?: string; EMAIL_FROM?: string },
  args: { toEmail: string; toName: string; reference: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return { ok: false, error: 'Email is not configured yet.' };
  }

  if (!EMAIL_RE.test(args.toEmail)) {
    return { ok: false, error: 'Contact on file is not a valid email address.' };
  }

  const html = emailShell(`
    <h1 style="font-size:22px;margin:0 0 16px;">We received your booking request</h1>
    <p style="font-size:15px;line-height:1.6;">Hi ${escapeHtml(args.toName)},</p>
    <p style="font-size:15px;line-height:1.6;">
      Thank you for scheduling with us. We've received your payment submission and details. 
      Our team is reviewing your booking and will confirm your appointment shortly.
    </p>
    <p style="font-size:13px;color:#4B5760;margin-top:24px;">Your booking reference: <strong>${escapeHtml(args.reference)}</strong></p>
  `);

  return sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    to: args.toEmail,
    subject: `Booking Request Received (${args.reference}) — The Psychology Square`,
    html,
  });
}