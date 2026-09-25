// Transactional email via Brevo (https://www.brevo.com) — Transactional Email API.
// Used ONLY for paid-course payment/enrollment notifications. Therapy
// booking emails and workshop emails stay on Resend (see src/lib/email.ts)
// — this file is intentionally self-contained and does not import or share
// any sending logic with email.ts, so the two providers can be reasoned
// about, debugged, and swapped out independently.
//
// NOTE: sign-in no longer sends email at all -- learners sign in with
// Google (see src/lib/googleAuth.ts), so the old sendMagicLinkEmail
// function was removed along with the magic-link flow itself.
//
// NOTE: course-completion certificate emails were intentionally removed
// (there's no sendCertificateEmail here) — the certificate page is shown
// immediately in the UI with its own PDF download, so a follow-up email
// would just be a redundant Brevo send.
//
// Brevo's free tier caps at 300 transactional emails/day (resets daily, no
// rollover). If that limit is ever hit, Brevo queues the overflow to send
// once the quota resets rather than failing outright — but errors below are
// still logged so a real failure (bad key, bad sender, etc.) is visible.
//
// Requires two things set on the Worker:
//   - BREVO_API_KEY     (secret)  — from Brevo → Settings → SMTP & API → API Keys
//   - BREVO_EMAIL_FROM   (var)    — e.g. "TPS Team <info@thepsychologysquare.com>"
//                                   Must be a sender verified in Brevo, on a
//                                   domain that's been authenticated there.
// Optional:
//   - BREVO_ADMIN_EMAIL  (var)    — where admin notifications go. Falls back to
//                                   the address portion of BREVO_EMAIL_FROM.

interface EmailAttachment {
  filename: string;
  content: string; // base64-encoded, no data: URI prefix
}

interface SendEmailArgs {
  apiKey: string;
  fromHeader: string; // "Name <email>" or bare "email"
  toEmail: string;
  toName?: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}

function parseAddress(header: string): { name?: string; email: string } {
  const match = header.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  if (match) {
    const name = match[1].replace(/^"|"$/g, '').trim();
    return { name: name || undefined, email: match[2].trim() };
  }
  return { email: header.trim() };
}

async function sendEmail({ apiKey, fromHeader, toEmail, toName, subject, html, attachments }: SendEmailArgs): Promise<{ ok: boolean; error?: string }> {
  try {
    const sender = parseAddress(fromHeader);
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        sender: sender.name ? { name: sender.name, email: sender.email } : { email: sender.email },
        to: [toName ? { email: toEmail, name: toName } : { email: toEmail }],
        subject,
        htmlContent: html,
        ...(attachments?.length
          ? { attachment: attachments.map((a) => ({ name: a.filename, content: a.content })) }
          : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[email-brevo] Brevo API error ${res.status} sending "${subject}" to ${toEmail}: ${body}`);
      return { ok: false, error: `Brevo ${res.status}: ${body}` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown email error';
    console.error(`[email-brevo] Failed to send "${subject}" to ${toEmail}: ${message}`);
    return { ok: false, error: message };
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- Paid courses: payment proof -> admin review -> unlock ----------

export async function sendCoursePaymentReceivedEmail(
  env: { BREVO_API_KEY?: string; BREVO_EMAIL_FROM?: string },
  args: { toEmail: string; toName: string; courseTitle: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.BREVO_API_KEY || !env.BREVO_EMAIL_FROM) {
    console.error('[email-brevo] sendCoursePaymentReceivedEmail: missing BREVO_API_KEY or BREVO_EMAIL_FROM');
    return { ok: false, error: 'Email is not configured yet.' };
  }
  if (!EMAIL_RE.test(args.toEmail)) {
    return { ok: false, error: 'Contact on file is not an email address.' };
  }
  const html = emailShell(`
    <h1 style="font-size:22px;margin:0 0 16px;">We've received your enrollment request</h1>
    <p style="font-size:15px;line-height:1.6;">Hi ${escapeHtml(args.toName)},</p>
    <p style="font-size:15px;line-height:1.6;">
      Thanks for requesting to enroll in <strong>${escapeHtml(args.courseTitle)}</strong>. We've received the
      screenshot you attached and we'll review it shortly — you'll get another email confirming your enrollment
      once we've checked it, usually within 24 hours.
    </p>
  `);
  return sendEmail({
    apiKey: env.BREVO_API_KEY,
    fromHeader: env.BREVO_EMAIL_FROM,
    toEmail: args.toEmail,
    toName: args.toName,
    subject: `We've received your request — ${args.courseTitle}`,
    html,
  });
}

export async function sendNewCoursePaymentAdminEmail(
  env: { BREVO_API_KEY?: string; BREVO_EMAIL_FROM?: string; BREVO_ADMIN_EMAIL?: string },
  args: { learnerName: string; learnerEmail: string; courseTitle: string; amountPkr: number; paymentMethod: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.BREVO_API_KEY || !env.BREVO_EMAIL_FROM) {
    console.error('[email-brevo] sendNewCoursePaymentAdminEmail: missing BREVO_API_KEY or BREVO_EMAIL_FROM');
    return { ok: false, error: 'Email is not configured yet.' };
  }
  const adminAddress = env.BREVO_ADMIN_EMAIL || parseAddress(env.BREVO_EMAIL_FROM).email;
  const html = emailShell(`
    <h1 style="font-size:20px;margin:0 0 16px;">New Course Payment Submission</h1>
    <p style="font-size:14px;line-height:1.5;">A new paid-course enrollment is waiting for review:</p>
    <ul style="font-size:14px;line-height:1.6;padding-left:20px;">
      <li><strong>Course:</strong> ${escapeHtml(args.courseTitle)}</li>
      <li><strong>Learner:</strong> ${escapeHtml(args.learnerName)} (${escapeHtml(args.learnerEmail)})</li>
      <li><strong>Amount:</strong> PKR ${args.amountPkr} via ${escapeHtml(args.paymentMethod)}</li>
    </ul>
    <p style="font-size:13px;color:#4B5760;">Review it in the "Course Enrollment Requests" tab on the dashboard.</p>
  `);
  return sendEmail({
    apiKey: env.BREVO_API_KEY,
    fromHeader: env.BREVO_EMAIL_FROM,
    toEmail: adminAddress,
    subject: `[New Course Payment] ${args.courseTitle} - ${args.learnerName}`,
    html,
  });
}

export async function sendCourseEnrollmentStatusEmail(
  env: { BREVO_API_KEY?: string; BREVO_EMAIL_FROM?: string },
  args: { toEmail: string; toName: string; courseTitle: string; status: 'active' | 'declined'; courseUrl?: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.BREVO_API_KEY || !env.BREVO_EMAIL_FROM) {
    console.error('[email-brevo] sendCourseEnrollmentStatusEmail: missing BREVO_API_KEY or BREVO_EMAIL_FROM');
    return { ok: false, error: 'Email is not configured yet.' };
  }
  if (!EMAIL_RE.test(args.toEmail)) {
    return { ok: false, error: 'Contact on file is not an email address.' };
  }
  const isConfirmed = args.status === 'active';
  const heading = isConfirmed ? 'Your enrollment is confirmed' : 'About your course payment';
  const body = isConfirmed
    ? `Your payment for <strong>${escapeHtml(args.courseTitle)}</strong> has been confirmed and your lessons are unlocked. Head back in to get started.`
    : `We couldn't confirm your payment for <strong>${escapeHtml(args.courseTitle)}</strong> — usually this means the screenshot was unclear. Please resubmit with a clearer screenshot, or get in touch with us directly.`;
  const html = emailShell(`
    <h1 style="font-size:22px;margin:0 0 16px;">${heading}</h1>
    <p style="font-size:15px;line-height:1.6;">Hi ${escapeHtml(args.toName)},</p>
    <p style="font-size:15px;line-height:1.6;">${body}</p>
    ${isConfirmed && args.courseUrl ? `<p style="margin:28px 0;"><a href="${args.courseUrl}" style="background:#C7A44A;color:#131A22;text-decoration:none;padding:12px 24px;border-radius:2px;font-weight:600;display:inline-block;">Start the course</a></p>` : ''}
  `);
  return sendEmail({
    apiKey: env.BREVO_API_KEY,
    fromHeader: env.BREVO_EMAIL_FROM,
    toEmail: args.toEmail,
    toName: args.toName,
    subject: isConfirmed ? `You're enrolled — ${args.courseTitle}` : `About your payment — ${args.courseTitle}`,
    html,
  });
}

// ---------- Paid courses: completion (certificate earned) ----------
// Fires once, right after a learner passes a PAID course's quiz and its
// certificate is saved (see src/pages/api/courses/submit.ts). Free courses
// never call this -- the certificate page itself, with its own PDF download,
// is enough there. For a paid course this doubles as a "you got what you
// paid for" receipt, so it's worth the extra send.
export async function sendCourseCompletedEmail(
  env: { BREVO_API_KEY?: string; BREVO_EMAIL_FROM?: string },
  args: { toEmail: string; toName: string; courseTitle: string; scorePercent: number; ceHours: number; certificateUrl: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.BREVO_API_KEY || !env.BREVO_EMAIL_FROM) {
    console.error('[email-brevo] sendCourseCompletedEmail: missing BREVO_API_KEY or BREVO_EMAIL_FROM');
    return { ok: false, error: 'Email is not configured yet.' };
  }
  if (!EMAIL_RE.test(args.toEmail)) {
    return { ok: false, error: 'Contact on file is not an email address.' };
  }
  const html = emailShell(`
    <h1 style="font-size:22px;margin:0 0 16px;">You've completed the course</h1>
    <p style="font-size:15px;line-height:1.6;">Hi ${escapeHtml(args.toName)},</p>
    <p style="font-size:15px;line-height:1.6;">
      Congratulations — you've completed <strong>${escapeHtml(args.courseTitle)}</strong> with a score of
      ${args.scorePercent}%. Your certificate is ready to view and download.
    </p>
    <p style="margin:28px 0;"><a href="${args.certificateUrl}" style="background:#C7A44A;color:#131A22;text-decoration:none;padding:12px 24px;border-radius:2px;font-weight:600;display:inline-block;">View your certificate</a></p>
    <p style="font-size:15px;line-height:1.6;">Thank you for taking this course with us.</p>
  `);
  return sendEmail({
    apiKey: env.BREVO_API_KEY,
    fromHeader: env.BREVO_EMAIL_FROM,
    toEmail: args.toEmail,
    toName: args.toName,
    subject: `You've completed ${args.courseTitle}`,
    html,
  });
}
