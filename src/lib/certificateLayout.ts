// Single source of truth for the certificate PDF's visual layout.
//
// This used to be copy-pasted in two places (the server-side emailer and the
// client-side "Download PDF" button), which is exactly how they'd drift out
// of sync. Now both call drawCertificate() below — one implementation, so
// the emailed PDF and the one a learner downloads are byte-for-byte the
// same drawing logic, not just "similar".
//
// The other half of what this file fixes: the old version placed every
// element at a hardcoded (x, y) point and called doc.text(name, ...) with no
// regard for how wide `name` actually was. jsPDF does NOT wrap or shrink
// text to fit — a long name or course title just drew past the border,
// overlapping whatever came next. That's the "looks fine on the site, breaks
// in the PDF" bug: the HTML page reflows with CSS; jsPDF does not reflow at
// all unless the code measures and adapts itself.
//
// So everything below is either:
//   (a) pinned at a fixed distance from an EDGE of the page (the logo, the
//       signature row, the certificate ID/verification footer) — these never
//       move, no matter how much text is above them, or
//   (b) auto-fit: measured with doc.getTextWidth() and shrunk (and, for the
//       course title only, wrapped) until it fits, then the whole name/course
//       block is vertically centered in the fixed space left between (a)'s
//       top and bottom anchors.
// A one-word name and a three-line course title land in the same certificate
// shape; only the middle stretches or the font shrinks to absorb it.

import { SIGNATURE_SOHAIL, SIGNATURE_SEHAR } from './certificateAssets';

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
const GOLD_SOFT: [number, number, number] = [227, 200, 120];
const SAGE: [number, number, number] = [124, 152, 133];
const INK: [number, number, number] = [19, 26, 34];
const INK_LIGHT: [number, number, number] = [75, 87, 96];
const PAPER: [number, number, number] = [248, 249, 246];
const LINE: [number, number, number] = [214, 209, 197];

/** Any jsPDF instance — kept loose so this compiles against the same
 * `jspdf` package whether it's imported server-side or client-side. */
type PdfLike = any;

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
 * centered on (cx, cy) at the given overall size. `lineWidth` defaults to
 * scaling with size (right for the small corner/header marks); pass an
 * explicit thin value for the big background watermark so its stroke stays
 * hairline-thin even at a huge size — otherwise a size-scaled stroke at low
 * opacity still reads as a solid, oddly-placed box rather than a faint mark. */
function drawMark(doc: PdfLike, cx: number, cy: number, size: number, opacity = 1, lineWidth?: number) {
  const sq = size * 0.72;
  const gState = opacity < 1 ? new doc.GState({ opacity }) : null;
  if (gState) doc.setGState(gState);

  doc.setDrawColor(...GOLD);
  doc.setLineWidth(lineWidth ?? Math.max(0.8, size * 0.045));
  doc.rect(cx - sq * 0.62, cy - sq * 0.62, sq, sq);

  doc.setDrawColor(...SAGE);
  doc.rect(cx - sq * 0.12, cy - sq * 0.12, sq, sq);

  if (gState) doc.setGState(new doc.GState({ opacity: 1 }));
}

export function drawCertificate(doc: PdfLike, args: CertificatePdfArgs): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const centerX = pageWidth / 2;

  // ---- Paper + frame ----------------------------------------------------
  doc.setFillColor(...PAPER);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');

  // Faint oversized watermark of the brand mark, centered — the "not quite
  // so bare" touch the design asked for, without becoming a cliché seal.
  // Deliberately hairline-thin and very low opacity, and large enough to
  // bleed past the frame: a thick stroke or a size that lands neatly inside
  // the text block reads as a stray box, not a watermark.
  drawMark(doc, centerX, pageHeight / 2 + 4, pageHeight * 1.05, 0.035, 2.2);

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
  ].forEach(([x, y]) => drawMark(doc, x, y, cornerSize, 0.55));

  // ---- Fixed top block: logomark, eyebrow, title, rule ------------------
  const logoY = 54;
  drawMark(doc, centerX, logoY, 20);

  doc.setTextColor(...GOLD);
  doc.setFont('courier', 'bold');
  doc.setFontSize(12.5);
  doc.text('T H E   P S Y C H O L O G Y   S Q U A R E', centerX, logoY + 30, { align: 'center' });

  doc.setTextColor(...INK);
  doc.setFont('times', 'bold');
  doc.setFontSize(30);
  doc.text('Certificate of Completion', centerX, logoY + 64, { align: 'center' });

  doc.setDrawColor(...GOLD);
  doc.setLineWidth(1);
  doc.line(centerX - 26, logoY + 78, centerX + 26, logoY + 78);

  const topBlockBottom = logoY + 78;

  // ---- Fixed bottom block: signatures + footer ---------------------------
  // Everything below is measured UP from pageHeight, so it never shifts
  // regardless of what the auto-fit block above ends up needing.
  const footerLinkY = pageHeight - 20;
  const footerIdY = footerLinkY - 12;
  const sigRoleY = footerIdY - 26;
  const sigNameY = sigRoleY - 13;
  const sigLineY = sigNameY - 12;
  const sigMaxH = 28;
  const sigBottomGap = 5;
  const sigImgBottomY = sigLineY - sigBottomGap;
  const sigImgTopY = sigImgBottomY - sigMaxH;

  const bottomBlockTop = sigImgTopY - 18;

  // ---- Flexible middle: name / course title, auto-fit + centered --------
  const maxTextWidth = pageWidth - outerInset * 2 - 140;
  const zoneTop = topBlockBottom + 20;
  const zoneBottom = bottomBlockTop;

  const label1 = 'This certifies that';
  const label2 = 'has successfully completed';

  const nameSize = fitSingleLine(doc, args.name, maxTextWidth, 'times', 'bolditalic', 27, 15);

  let courseSize = fitSingleLine(doc, args.courseTitle, maxTextWidth, 'times', 'bold', 19, 13);
  doc.setFont('times', 'bold');
  doc.setFontSize(courseSize);
  let courseLines: string[] = doc.splitTextToSize(args.courseTitle, maxTextWidth);
  // Extremely long titles: shrink further rather than spilling past 2 lines.
  while (courseLines.length > 2 && courseSize > 10) {
    courseSize -= 1;
    doc.setFontSize(courseSize);
    courseLines = doc.splitTextToSize(args.courseTitle, maxTextWidth);
  }

  const label1H = 15;
  const nameH = nameSize * 1.2;
  const label2H = 15;
  const courseLineH = courseSize * 1.22;
  const courseH = courseLineH * courseLines.length;
  const dateH = 14;
  const gapSmall = 6;
  const gapMed = 9;

  const blockHeight =
    label1H + gapSmall + nameH + gapMed + label2H + gapSmall + courseH + gapMed + dateH;

  const available = zoneBottom - zoneTop;
  const startY = zoneTop + Math.max(0, (available - blockHeight) / 2);

  // cursorY always tracks the top of the NEXT element; each block below
  // advances it by that element's own height plus the gap that follows.
  let cursorY = startY;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12.5);
  doc.setTextColor(...INK_LIGHT);
  doc.text(label1, centerX, cursorY + label1H * 0.75, { align: 'center' });
  cursorY += label1H + gapSmall;

  doc.setFont('times', 'bolditalic');
  doc.setFontSize(nameSize);
  doc.setTextColor(...INK);
  doc.text(args.name, centerX, cursorY + nameH * 0.78, { align: 'center' });
  cursorY += nameH + gapMed;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12.5);
  doc.setTextColor(...INK_LIGHT);
  doc.text(label2, centerX, cursorY + label2H * 0.75, { align: 'center' });
  cursorY += label2H + gapSmall;

  doc.setFont('times', 'bold');
  doc.setFontSize(courseSize);
  doc.setTextColor(...INK);
  for (const line of courseLines) {
    doc.text(line, centerX, cursorY + courseLineH * 0.78, { align: 'center' });
    cursorY += courseLineH;
  }
  cursorY += gapMed;

  doc.setFont('courier', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(...INK_LIGHT);
  doc.text(`Issued ${args.date}`, centerX, cursorY + dateH * 0.75, { align: 'center' });

  // ---- Signatures (fixed position, never affected by the above) ---------
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
    doc.line(colX - 62, sigLineY, colX + 62, sigLineY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...INK);
    doc.text(personName, colX, sigNameY, { align: 'center' });

    doc.setFont('courier', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GOLD);
    doc.text(role.toUpperCase(), colX, sigRoleY, { align: 'center' });
  };

  drawSignature(centerX - 118, SIGNATURE_SOHAIL, 'Muhammad Sohail', 'CEO');
  drawSignature(centerX + 118, SIGNATURE_SEHAR, 'Sehar Waheed', 'Co-CEO');

  // ---- Very bottom: certificate ID + verification link ------------------
  // Deliberately tiny and tight to the edge — informational, not decorative.
  doc.setFont('courier', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...INK_LIGHT);
  doc.text(`Certificate ID: ${args.certId}`, centerX, footerIdY, { align: 'center' });
  doc.text(`thepsychologysquare.com/certificates/${args.certId}`, centerX, footerLinkY, { align: 'center' });
}
