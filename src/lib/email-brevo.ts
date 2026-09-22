// Transactional email via Brevo (https://www.brevo.com) — Transactional Email API.
// Used ONLY for: magic-link sign-in/enroll/view-certificates links, certificate
// delivery, and paid-course payment/enrollment notifications. Therapy booking
// emails and workshop emails stay on Resend (see src/lib/email.ts) — this file
// is intentionally self-contained and does not import or share any sending
// logic with email.ts, so the two providers can be reasoned about, debugged,
// and swapped out independently.
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

export async function sendMagicLinkEmail(
  env: { BREVO_API_KEY?: string; BREVO_EMAIL_FROM?: string },
  args: { toEmail: string; link: string; purpose?: 'enroll' | 'view-certificates' | 'sign-in'; courseTitle?: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.BREVO_API_KEY || !env.BREVO_EMAIL_FROM) {
    console.error('[email-brevo] sendMagicLinkEmail: missing BREVO_API_KEY or BREVO_EMAIL_FROM');
    return { ok: false, error: 'Email is not configured yet (missing BREVO_API_KEY or BREVO_EMAIL_FROM).' };
  }

  const isEnroll = args.purpose === 'enroll';
  const isSignIn = args.purpose === 'sign-in';
  const heading = isEnroll ? 'Confirm your enrollment' : isSignIn ? 'Sign in to your account' : 'View your certificates';
  const body = isEnroll
    ? `Click the button below to confirm your email and finish enrolling${args.courseTitle ? ` in <strong>${args.courseTitle}</strong>` : ''}. This link works once and expires in 15 minutes.`
    : isSignIn
    ? `Click the button below to sign in to your account. This link works once and expires in 15 minutes.`
    : `Click the button below to see every certificate you've earned with us. This link works once and expires in 15 minutes.`;
  const buttonText = isEnroll ? 'Confirm enrollment' : isSignIn ? 'Sign in' : 'View my certificates';
  const subject = isEnroll ? 'Confirm your course enrollment — The Psychology Square' : isSignIn ? 'Your sign-in link — The Psychology Square' : 'Your certificates link — The Psychology Square';

  const html = emailShell(`
    <h1 style="font-size:22px;margin:0 0 16px;">${heading}</h1>
    <p style="font-size:15px;line-height:1.6;">${body}</p>
    <p style="margin:28px 0;">
      <a href="${args.link}" style="background:#C7A44A;color:#131A22;text-decoration:none;padding:12px 24px;border-radius:2px;font-weight:600;display:inline-block;">${buttonText}</a>
    </p>
    <p style="font-size:13px;color:#4B5760;">If you didn't request this, you can safely ignore this email.</p>
  `);
  return sendEmail({
    apiKey: env.BREVO_API_KEY,
    fromHeader: env.BREVO_EMAIL_FROM,
    toEmail: args.toEmail,
    subject,
    html,
  });
}

export async function sendCertificateEmail(
  env: { BREVO_API_KEY?: string; BREVO_EMAIL_FROM?: string },
  args: {
    toEmail: string; toName: string; courseTitle: string; certUrl: string; certificateId: string;
    pdfBase64?: string; // optional — attaches the certificate as a downloadable PDF
  }
): Promise<{ ok: boolean; error?: string }> {
  if (!env.BREVO_API_KEY || !env.BREVO_EMAIL_FROM) {
    console.error('[email-brevo] sendCertificateEmail: missing BREVO_API_KEY or BREVO_EMAIL_FROM');
    return { ok: false, error: 'Email is not configured yet (missing BREVO_API_KEY or BREVO_EMAIL_FROM).' };
  }
  const html = emailShell(`
    <h1 style="font-size:22px;margin:0 0 16px;">Congratulations, ${escapeHtml(args.toName)}!</h1>
    <p style="font-size:15px;line-height:1.6;">You've completed <strong>${escapeHtml(args.courseTitle)}</strong> and earned your certificate.${args.pdfBase64 ? ' The PDF is attached to this email.' : ''}</p>
    <p style="margin:28px 0;">
      <a href="${args.certUrl}" style="background:#C7A44A;color:#131A22;text-decoration:none;padding:12px 24px;border-radius:2px;font-weight:600;display:inline-block;">View your certificate</a>
    </p>
    <p style="font-size:13px;color:#4B5760;">Certificate ID: ${escapeHtml(args.certificateId)}<br/>This link is permanent and publicly verifiable — anyone with it can confirm the certificate is genuine.</p>
  `);
  return sendEmail({
    apiKey: env.BREVO_API_KEY,
    fromHeader: env.BREVO_EMAIL_FROM,
    toEmail: args.toEmail,
    toName: args.toName,
    subject: `Your certificate for ${args.courseTitle}`,
    html,
    attachments: args.pdfBase64 ? [{ filename: `${args.certificateId}.pdf`, content: args.pdfBase64 }] : undefined,
  });
}

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
    <h1 style="font-size:22px;margin:0 0 16px;">We received your payment</h1>
    <p style="font-size:15px;line-height:1.6;">Hi ${escapeHtml(args.toName)},</p>
    <p style="font-size:15px;line-height:1.6;">
      Thank you for enrolling in <strong>${escapeHtml(args.courseTitle)}</strong>. We've received your payment
      submission and we'll confirm your enrollment within 24 hours — you'll get another email the moment
      your lessons unlock.
    </p>
  `);
  return sendEmail({
    apiKey: env.BREVO_API_KEY,
    fromHeader: env.BREVO_EMAIL_FROM,
    toEmail: args.toEmail,
    toName: args.toName,
    subject: `We've received your payment — ${args.courseTitle}`,
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
