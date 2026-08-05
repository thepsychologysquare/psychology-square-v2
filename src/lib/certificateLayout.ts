// Single source of truth for the certificate PDF's visual layout.
//
// This used to be copy-pasted in two places (the server-side emailer and the
// client-side "Download PDF" button), which is exactly how they'd drift out
// of sync. Now both call drawCertificate() below — one implementation, so
// the emailed PDF and the one a learner downloads are byte-for-byte the
// same drawing logic, not just "similar".
//
// FONTS: jsPDF's built-in fonts are Helvetica/Times/Courier only — nothing
// like the site's Fraunces (serif display) or Inter (sans body). We embed
// the real font files for all three families used on the certificate below
// (Fraunces SemiBold/SemiBoldItalic, Inter Regular/Bold, IBM Plex Mono
// Regular/Bold), so every element — heading, name, body copy, signature
// names, eyebrow, date, footer — is the exact same typeface as the website,
// not a built-in stand-in.
//
// LAYOUT: everything is either (a) pinned at a fixed distance from an edge
// of the page (the logo/header at the top; the certificate ID/verification
// footer at the very bottom), or (b) auto-fit — name and course title are
// measured with doc.getTextWidth() and shrunk (course title also wraps, up
// to 2 lines) until they fit, so a long name or long title can never run
// off the page the way it used to. The name/course block flows immediately
// under the header, the same as the HTML page's natural top-down layout;
// the signature row sits a fixed gap below that content, UNLESS the content
// is long enough that this would push signatures too close to the footer,
// in which case they clamp to a fixed position near the bottom instead —
// so short certificates look like the compact HTML page, and pathological
// long ones still can't overlap or overflow.

import {
  SIGNATURE_SOHAIL,
  SIGNATURE_SEHAR,
  FONT_MONO_REGULAR_BASE64,
  FONT_MONO_BOLD_BASE64,
  FONT_SERIF_REGULAR_BASE64,
  FONT_SERIF_BOLD_BASE64,
  FONT_SERIF_BOLDITALIC_BASE64,
  FONT_SANS_REGULAR_BASE64,
  FONT_SANS_BOLD_BASE64,
} from './certificateAssets';

export interface CertificatePdfArgs {
  name: string;
  courseTitle: string;
  date: string; // already formatted, e.g. "August 2, 2026"
  certId: string;
  /**
   * Kept for backward compatibility with callers/DB records that still pass
   * these — the certificate no longer prints score or hours (design
   * decision: a completion certificate, not a transcript), so both are
   * accepted but ignored here.
   */
  ceHours?: number;
  scorePercent?: number;
}

// Brand palette (mirrors src/styles/global.css custom properties).
const GOLD: [number, number, number] = [199, 164, 74];
const SAGE: [number, number, number] = [124, 152, 133];
const INK: [number, number, number] = [19, 26, 34];
const INK_LIGHT: [number, number, number] = [75, 87, 96];
const NAVY_TEXT: [number, number, number] = [28, 49, 76]; // --navy-700: readable brand color for small text on light paper
const PAPER: [number, number, number] = [248, 249, 246];
const LINE: [number, number, number] = [214, 209, 197];

// Real embedded fonts — exact matches to the site's --font-mono,
// --font-display, and --font-body, respectively.
const MONO = 'IBMPlexMono';
const FONT_SERIF = 'Fraunces';
const FONT_SANS = 'Inter';

/** Any jsPDF instance — kept loose so this compiles against the same
 * `jspdf` package whether it's imported server-side or client-side. */
type PdfLike = any;

let fontsRegistered = false;
function ensureFontsRegistered(doc: PdfLike) {
  // jsPDF fonts are registered per-document, but the VFS file names are
  // global-module-safe to add repeatedly — guard anyway to skip the (small)
  // repeat cost within the same process.
  doc.addFileToVFS('IBMPlexMono-Regular.ttf', FONT_MONO_REGULAR_BASE64);
  doc.addFont('IBMPlexMono-Regular.ttf', MONO, 'normal');
  doc.addFileToVFS('IBMPlexMono-Bold.ttf', FONT_MONO_BOLD_BASE64);
  doc.addFont('IBMPlexMono-Bold.ttf', MONO, 'bold');

  // Fraunces: 'normal' (Regular/400) is used only by the plain-<div> title
  // ("Certificate of Completion"), which doesn't inherit the site's h1-h3
  // font-weight:600 rule. 'bold'/'bolditalic' (SemiBold/600) are used for
  // the name and course title, which DO set font-weight:600 explicitly.
  doc.addFileToVFS('Fraunces-Regular.ttf', FONT_SERIF_REGULAR_BASE64);
  doc.addFont('Fraunces-Regular.ttf', FONT_SERIF, 'normal');
  doc.addFileToVFS('Fraunces-SemiBold.ttf', FONT_SERIF_BOLD_BASE64);
  doc.addFont('Fraunces-SemiBold.ttf', FONT_SERIF, 'bold');
  doc.addFileToVFS('Fraunces-SemiBoldItalic.ttf', FONT_SERIF_BOLDITALIC_BASE64);
  doc.addFont('Fraunces-SemiBoldItalic.ttf', FONT_SERIF, 'bolditalic');

  doc.addFileToVFS('Inter-Regular.ttf', FONT_SANS_REGULAR_BASE64);
  doc.addFont('Inter-Regular.ttf', FONT_SANS, 'normal');
  doc.addFileToVFS('Inter-Bold.ttf', FONT_SANS_BOLD_BASE64);
  doc.addFont('Inter-Bold.ttf', FONT_SANS, 'bold');

  fontsRegistered = true;
}

function fitSingleLine(
  doc: PdfLike,
  text: string,
  maxWidth: number,
  font: string,
  style: string,
  maxSize: number,
  minSize: number
): number {
  doc.setFont(font, style);
  let size = maxSize;
  while (size > minSize) {
    doc.setFontSize(size);
    if (doc.getTextWidth(text) <= maxWidth) return size;
    size -= 0.5;
  }
  doc.setFontSize(minSize);
  return minSize;
}

/** Draws the small two-square brand mark (echoes the site header's logomark)
 * centered on (cx, cy) at the given overall size. */
function drawMark(doc: PdfLike, cx: number, cy: number, size: number) {
  const sq = size * 0.72;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(Math.max(0.8, size * 0.045));
  doc.rect(cx - sq * 0.62, cy - sq * 0.62, sq, sq);

  doc.setDrawColor(...SAGE);
  doc.rect(cx - sq * 0.12, cy - sq * 0.12, sq, sq);
}

export function drawCertificate(doc: PdfLike, args: CertificatePdfArgs): void {
  ensureFontsRegistered(doc);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const centerX = pageWidth / 2;

  // ---- Paper + frame ----------------------------------------------------
  doc.setFillColor(...PAPER);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');

  const outerInset = 24;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(1.4);
  doc.rect(outerInset, outerInset, pageWidth - outerInset * 2, pageHeight - outerInset * 2);

  const innerInset = outerInset + 7;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.6);
  doc.rect(innerInset, innerInset, pageWidth - innerInset * 2, pageHeight - innerInset * 2);

  // Small corner marks just inside the frame, echoing the logomark.
  const cornerInset = innerInset + 15;
  const cornerSize = 11;
  [
    [cornerInset, cornerInset],
    [pageWidth - cornerInset, cornerInset],
    [cornerInset, pageHeight - cornerInset],
    [pageWidth - cornerInset, pageHeight - cornerInset],
  ].forEach(([x, y]) => drawMark(doc, x, y, cornerSize));

  // ---- Fixed top block: logomark, eyebrow, title, rule ------------------
  const logoY = 54;
  drawMark(doc, centerX, logoY, 20);

  // Brand name in a dark, readable navy rather than gold — gold-on-cream
  // reads fine as a thin border/rule but fails as small text (this brand's
  // gold is designed for use on the dark navy header, not on light paper).
  doc.setTextColor(...NAVY_TEXT);
  doc.setFont(MONO, 'bold');
  doc.setFontSize(12.5);
  doc.text('T H E   P S Y C H O L O G Y   S Q U A R E', centerX, logoY + 30, { align: 'center' });

  doc.setTextColor(...INK);
  doc.setFont(FONT_SERIF, 'normal');
  doc.setFontSize(30);
  doc.text('Certificate of Completion', centerX, logoY + 64, { align: 'center' });

  doc.setDrawColor(...GOLD);
  doc.setLineWidth(1);
  doc.line(centerX - 26, logoY + 78, centerX + 26, logoY + 78);

  const topBlockBottom = logoY + 78;

  // ---- Fixed bottom block: signatures + footer ---------------------------
  // The footer (certificate ID + verification link) is always pinned this
  // far from the page bottom. The signature row's fixed-from-bottom values
  // below are its LOWEST allowed position (a safety ceiling for very long
  // content) — see the clamp further down for its normal, content-hugging
  // position.
  const footerLinkY = pageHeight - 20;
  const footerIdY = footerLinkY - 12;
  const sigRoleYMax = footerIdY - 28;
  const sigNameYMax = sigRoleYMax - 15;
  const sigLineYMax = sigNameYMax - 12;
  const sigMaxH = 28;
  const sigBottomGap = 5;

  // ---- Name / course title: auto-fit, then flow top-down like the HTML --
  const maxTextWidth = pageWidth - outerInset * 2 - 140;
  const contentTop = topBlockBottom + 26;

  const label1 = 'This certifies that';
  const label2 = 'has successfully completed';

  const nameSize = (() => {
    let size = fitSingleLine(doc, args.name, maxTextWidth, FONT_SERIF, 'bolditalic', 27, 15);
    doc.setFont(FONT_SERIF, 'bolditalic');
    doc.setFontSize(size);
    // Mirror the HTML: the name isn't forced onto one line — it wraps
    // naturally, same as the course title below. Only shrink further if it
    // still doesn't fit in 2 lines at the minimum readable size.
    let lines = doc.splitTextToSize(args.name, maxTextWidth);
    while (lines.length > 2 && size > 13) {
      size -= 1;
      doc.setFontSize(size);
      lines = doc.splitTextToSize(args.name, maxTextWidth);
    }
    return size;
  })();
  doc.setFont(FONT_SERIF, 'bolditalic');
  doc.setFontSize(nameSize);
  const nameLines: string[] = doc.splitTextToSize(args.name, maxTextWidth);

  let courseSize = fitSingleLine(doc, args.courseTitle, maxTextWidth, FONT_SERIF, 'bold', 19, 13);
  doc.setFont(FONT_SERIF, 'bold');
  doc.setFontSize(courseSize);
  let courseLines: string[] = doc.splitTextToSize(args.courseTitle, maxTextWidth);
  // Extremely long titles: shrink further rather than spilling past 2 lines.
  while (courseLines.length > 2 && courseSize > 10) {
    courseSize -= 1;
    doc.setFontSize(courseSize);
    courseLines = doc.splitTextToSize(args.courseTitle, maxTextWidth);
  }

  const label1H = 15;
  const nameLineH = nameSize * 1.2;
  const label2H = 15;
  const courseLineH = courseSize * 1.22;
  const gapSmall = 6;
  const gapMed = 9;

  // cursorY always tracks the top of the NEXT element; each block below
  // advances it by that element's own height plus the gap that follows.
  let cursorY = contentTop;

  doc.setFont(FONT_SANS, 'normal');
  doc.setFontSize(12.5);
  doc.setTextColor(...INK_LIGHT);
  doc.text(label1, centerX, cursorY + label1H * 0.75, { align: 'center' });
  cursorY += label1H + gapSmall;

  doc.setFont(FONT_SERIF, 'bolditalic');
  doc.setFontSize(nameSize);
  doc.setTextColor(...INK);
  for (const line of nameLines) {
    doc.text(line, centerX, cursorY + nameLineH * 0.78, { align: 'center' });
    cursorY += nameLineH;
  }
  cursorY += gapMed;

  doc.setFont(FONT_SANS, 'normal');
  doc.setFontSize(12.5);
  doc.setTextColor(...INK_LIGHT);
  doc.text(label2, centerX, cursorY + label2H * 0.75, { align: 'center' });
  cursorY += label2H + gapSmall;

  doc.setFont(FONT_SERIF, 'bold');
  doc.setFontSize(courseSize);
  doc.setTextColor(...INK);
  for (const line of courseLines) {
    doc.text(line, centerX, cursorY + courseLineH * 0.78, { align: 'center' });
    cursorY += courseLineH;
  }
  cursorY += gapMed;

  const dateH = 15;
  doc.setFont(MONO, 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...INK_LIGHT);
  doc.text(`Issued ${args.date}`, centerX, cursorY + dateH * 0.72, { align: 'center' });
  cursorY += dateH;

  // ---- Signatures ---------------------------------------------------------
  // Normally sit a fixed, HTML-like gap right below the content above. Only
  // for unusually long content does that push past the safety ceiling
  // (sigLineYMax etc.) — in which case we clamp to the ceiling instead, so
  // signatures never crowd the footer or run off the page.
  const naturalGapToSignatures = 44;
  const sigLineYFinal = Math.min(cursorY + naturalGapToSignatures, sigLineYMax);
  const sigNameYFinal = Math.min(sigLineYFinal + 17, sigNameYMax);
  const sigRoleYFinal = Math.min(sigNameYFinal + 15, sigRoleYMax);
  const sigImgBottomY = sigLineYFinal - sigBottomGap;

  const drawSignature = (
    colX: number,
    sig: { dataUri: string; width: number; height: number },
    personName: string,
    role: string
  ) => {
    const aspect = sig.width / sig.height;
    const maxW = 118;
    let h = sigMaxH;
    let w = h * aspect;
    if (w > maxW) {
      w = maxW;
      h = w / aspect;
    }
    const imgY = sigImgBottomY - h;
    doc.addImage(sig.dataUri, 'PNG', colX - w / 2, imgY, w, h, undefined, 'FAST');

    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.7);
    doc.line(colX - 62, sigLineYFinal, colX + 62, sigLineYFinal);

    doc.setFont(FONT_SANS, 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...INK);
    doc.text(personName, colX, sigNameYFinal, { align: 'center' });

    doc.setFont(MONO, 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...NAVY_TEXT);
    doc.text(role.toUpperCase(), colX, sigRoleYFinal, { align: 'center' });
  };

  drawSignature(centerX - 118, SIGNATURE_SOHAIL, 'Muhammad Sohail', 'CEO');
  drawSignature(centerX + 118, SIGNATURE_SEHAR, 'Sehar Waheed', 'Co-CEO');

  // ---- Very bottom: certificate ID + verification link ------------------
  // Deliberately tiny and tight to the edge — informational, not decorative.
  doc.setFont(MONO, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...INK_LIGHT);
  doc.text(`Certificate ID: ${args.certId}`, centerX, footerIdY, { align: 'center' });
  doc.text(`thepsychologysquare.com/certificates/${args.certId}`, centerX, footerLinkY, { align: 'center' });
}
