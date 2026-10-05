// Certificate design used ONLY for paid courses (see certificateLayout.ts
// for the free-course design, which this file does not touch or import
// into). Same fonts and same real signatures as the free design, sourced
// from the same certificateAssets.ts, so both designs stay visually
// consistent with the rest of the brand and never drift out of sync with
// each other when a font or signature is updated.
//
// Geometry follows the approved on-screen design (the 1080-wide replica /
// .certificate-paid in certificates/[id].astro) 1:1: every measurement below
// is written in "design px" (the 1080px-wide reference) and scaled to the
// page by k = pageWidth / 1080, so proportions match the web certificate.

import {
  SIGNATURE_SOHAIL,
  SIGNATURE_SEHAR,
  FONT_MONO_REGULAR_BASE64,
  FONT_MONO_BOLD_BASE64,
  FONT_SERIF_REGULAR_BASE64,
  FONT_SERIF_BOLD_BASE64,
  FONT_SANS_REGULAR_BASE64,
  FONT_SANS_BOLD_BASE64,
} from './certificateAssets';
import type { CertificatePdfArgs } from './certificateLayout';
import { buildQrMatrix, qrRuns, certificateVerifyUrl } from './certificateQr';

// `kind` is optional so existing callers keep working; 'workshop' only changes wording.
export type PaidCertificatePdfArgs = CertificatePdfArgs & { kind?: string };
export type { CertificatePdfArgs };

// Brand palette (navy/gold variant)
type RGB = [number, number, number];
const NAVY_950: RGB = [11, 20, 31];
const NAVY_800: RGB = [21, 36, 57];
const NAVY_700: RGB = [28, 49, 76];
const GOLD_500: RGB = [199, 164, 74];
const GOLD_300: RGB = [227, 200, 120];
const PAPER_50: RGB = [239, 241, 236];
const PAPER_0: RGB = [248, 249, 246];
const INK_900: RGB = [19, 26, 34];
const INK_600: RGB = [75, 87, 96];
// --line is rgba(19,26,34,.14) on screen; flattened here on paper / white.
const LINE_ON_PAPER: RGB = [216, 218, 216];
const LINE_ON_WHITE: RGB = [222, 223, 224];

const MONO = 'IBMPlexMono';
const FONT_SERIF = 'Fraunces';
const FONT_SANS = 'Inter';

type PdfLike = any;

// Per-document, not a module-level boolean: a long-lived server isolate builds
// many PDFs, and each new jsPDF instance needs its own font registration.
const fontsRegisteredFor = new WeakSet<object>();
function ensureFontsRegistered(doc: PdfLike) {
  if (fontsRegisteredFor.has(doc)) return;
  doc.addFileToVFS('IBMPlexMono-Regular.ttf', FONT_MONO_REGULAR_BASE64);
  doc.addFont('IBMPlexMono-Regular.ttf', MONO, 'normal');
  doc.addFileToVFS('IBMPlexMono-Bold.ttf', FONT_MONO_BOLD_BASE64);
  doc.addFont('IBMPlexMono-Bold.ttf', MONO, 'bold');

  doc.addFileToVFS('Fraunces-Regular.ttf', FONT_SERIF_REGULAR_BASE64);
  doc.addFont('Fraunces-Regular.ttf', FONT_SERIF, 'normal');
  doc.addFileToVFS('Fraunces-SemiBold.ttf', FONT_SERIF_BOLD_BASE64);
  doc.addFont('Fraunces-SemiBold.ttf', FONT_SERIF, 'bold');

  doc.addFileToVFS('Inter-Regular.ttf', FONT_SANS_REGULAR_BASE64);
  doc.addFont('Inter-Regular.ttf', FONT_SANS, 'normal');
  doc.addFileToVFS('Inter-Bold.ttf', FONT_SANS_BOLD_BASE64);
  doc.addFont('Inter-Bold.ttf', FONT_SANS, 'bold');

  fontsRegisteredFor.add(doc);
}

export function drawCertificatePaid(doc: PdfLike, args: PaidCertificatePdfArgs): void {
  ensureFontsRegistered(doc);

  const kindWord = args.kind === 'workshop' ? 'workshop' : 'course';
  const kindWordCap = kindWord === 'workshop' ? 'Workshop' : 'Course';

  const pageWidth: number = doc.internal.pageSize.getWidth();
  const pageHeight: number = doc.internal.pageSize.getHeight();

  // Design-px -> pt. Everything below is in design px unless noted.
  const k = pageWidth / 1080;
  const W = 1080;
  const H = pageHeight / k;

  // ---- tiny drawing helpers (design px in, pt out) -------------------------
  const fill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c: RGB, w: number) => { doc.setDrawColor(c[0], c[1], c[2]); doc.setLineWidth(w * k); };
  const rect = (x: number, y: number, w: number, h: number, style: string) => doc.rect(x * k, y * k, w * k, h * k, style);
  const text = (
    str: string, x: number, y: number,
    o: { font: string; style: 'normal' | 'bold'; size: number; color: RGB; align?: 'left' | 'center'; spacing?: number },
  ) => {
    doc.setFont(o.font, o.style);
    doc.setFontSize(o.size * k);
    doc.setTextColor(o.color[0], o.color[1], o.color[2]);
    const opts: any = { align: o.align || 'left' };
    if (o.spacing) opts.charSpace = o.spacing * k;
    doc.text(str, x * k, y * k, opts);
  };
  const width = (str: string, font: string, style: 'normal' | 'bold', size: number, spacing = 0) => {
    doc.setFont(font, style);
    doc.setFontSize(size * k);
    return doc.getTextWidth(str) / k + spacing * str.length;
  };

  // ---- page + columns -------------------------------------------------------
  const rightW = W * 0.32;
  const leftW = W - rightW;
  fill(PAPER_0);
  rect(0, 0, W, H, 'F');

  // ---- right column background: 165deg gradient navy-700 -> navy-950 @55% ---
  fill(NAVY_950);
  rect(leftW, 0, rightW, H, 'F');
  {
    doc.saveGraphicsState();
    rect(leftW, 0, rightW, H, null as any);
    doc.clip();
    doc.discardPath();
    const ang = (165 * Math.PI) / 180;
    const dx = Math.sin(ang), dy = -Math.cos(ang); // gradient direction
    const px = -dy, py = dx; // perpendicular
    const L = Math.abs(rightW * dx) + Math.abs(H * dy);
    const cx = leftW + rightW / 2, cy = H / 2;
    const steps = 140, stop = 0.55, big = rightW + H;
    for (let i = 0; i < steps; i++) {
      const t0 = (i / steps) * stop, t1 = ((i + 1) / steps) * stop + 0.004;
      const tm = (t0 + t1) / 2 / stop;
      const c: RGB = [0, 1, 2].map((n) => Math.round(NAVY_700[n] + (NAVY_950[n] - NAVY_700[n]) * tm)) as RGB;
      fill(c);
      const a0 = (t0 - 0.5) * L, a1 = (t1 - 0.5) * L;
      const p = (a: number, s: number): [number, number] => [(cx + dx * a + px * s) * k, (cy + dy * a + py * s) * k];
      const [x0, y0] = p(a0, -big), [x1, y1] = p(a0, big), [x2, y2] = p(a1, big), [x3, y3] = p(a1, -big);
      doc.lines([[x1 - x0, y1 - y0], [x2 - x1, y2 - y1], [x3 - x2, y3 - y2]], x0, y0, [1, 1], 'F', true);
    }
    doc.restoreGraphicsState();
  }

  // Gold accent strip along the outer right edge (1.111cqw = 12px)
  fill(GOLD_500);
  rect(W - 12, 0, 12, H, 'F');

  // =========================== LEFT COLUMN ===================================
  // padding: 4.5% 8% 4% (percentages of the left column's width, as in CSS)
  const padX = leftW * 0.08;
  const padTop = leftW * 0.045;
  const padBottom = leftW * 0.04;
  const maxTextWidth = leftW - padX * 2;

  // ---- top zone: logo, headline, subhead ------------------------------------
  const logoTop = padTop;
  const markSize = 34;
  {
    const u = markSize / 22; // viewBox 22 -> 34px
    stroke(NAVY_800, 2 * u);
    rect(padX + 1 * u, logoTop + 1 * u, 13 * u, 13 * u, 'S');
    stroke(GOLD_500, 2 * u);
    rect(padX + 8 * u, logoTop + 8 * u, 13 * u, 13 * u, 'S');
  }
  text('THE PSYCHOLOGY SQUARE', padX + markSize + 12, logoTop + markSize / 2 + 16 * 0.36, {
    font: MONO, style: 'bold', size: 16, color: NAVY_800, spacing: 16 * 0.15,
  });

  const headTop = logoTop + markSize + 16;
  text('Certificate', padX, headTop + 52 * 0.84, { font: FONT_SERIF, style: 'bold', size: 52, color: NAVY_800 });

  const subTop = headTop + 52 + 9;
  text('OF COMPLETION', padX, subTop + 13 * 0.97, { font: FONT_SANS, style: 'normal', size: 13, color: INK_600, spacing: 13 * 0.32 });
  const topBottom = subTop + 13 * 1.21;

  // ---- bottom zone: signatures (measured from the bottom up) ----------------
  const bottomY = H - padBottom;
  const roleH = 1 + 6 + 11.5 * 1.3;
  const roleTop = bottomY - roleH;
  const nameH = 19 * 1.23;
  const nameTop = roleTop - 5 - nameH;
  const sigSlotBottom = nameTop - 2; // 2px gap under the signature image
  const sigTop = sigSlotBottom - 28; // 28px = the replica's signature slot
  const sigZoneH = bottomY - sigTop;

  // ---- middle zone: "Presented to" block, vertically centred ---------------
  const baseName = 34, baseCourse = 19;
  const minName = 18, minCourse = 12;
  const zoneTop = topBottom;
  const zoneBottom = sigTop;

  const measure = (nameSize: number, courseSize: number) => {
    doc.setFont(FONT_SERIF, 'bold');
    doc.setFontSize(nameSize * k);
    const nameLines: string[] = doc.splitTextToSize(args.name, maxTextWidth * k);
    doc.setFont(FONT_SANS, 'bold');
    doc.setFontSize(courseSize * k);
    const courseLines: string[] = doc.splitTextToSize(args.courseTitle, maxTextWidth * k);
    const nameLH = nameSize * 1.23, courseLH = courseSize * 1.21;
    const h =
      15 * 1.21 + 5 + nameLines.length * nameLH + 16 +
      15 * 1.21 + 6 + courseLines.length * courseLH + 6 + 14 * 1.21;
    return { nameLines, courseLines, nameLH, courseLH, h };
  };

  let nameSize = baseName, courseSize = baseCourse;
  let m = measure(nameSize, courseSize);
  while (m.h > zoneBottom - zoneTop - 16 && nameSize > minName && courseSize > minCourse) {
    nameSize -= 0.8;
    courseSize -= 0.5;
    m = measure(nameSize, courseSize);
  }

  let y = zoneTop + (zoneBottom - zoneTop - m.h) / 2;
  text('Presented to', padX, y + 15 * 0.97, { font: FONT_SANS, style: 'normal', size: 15, color: INK_600 });
  y += 15 * 1.21 + 5;
  for (const line of m.nameLines) {
    text(line, padX, y + nameSize * 0.98, { font: FONT_SERIF, style: 'bold', size: nameSize, color: GOLD_500 });
    y += m.nameLH;
  }
  y += 16;
  text(`For successfully completing an online ${kindWord}`, padX, y + 15 * 0.97, { font: FONT_SANS, style: 'normal', size: 15, color: INK_600 });
  y += 15 * 1.21 + 6;
  for (const line of m.courseLines) {
    text(line, padX, y + courseSize * 0.97, { font: FONT_SANS, style: 'bold', size: courseSize, color: INK_900 });
    y += m.courseLH;
  }
  y += 6;
  text(`${kindWordCap} completed on ${args.date}`, padX, y + 14 * 0.97, { font: FONT_SANS, style: 'normal', size: 14, color: INK_600 });

  // ---- signatures: image, name, rule, ROLE (rule sits between name and role)
  const drawSignature = (
    colX: number,
    sig: { dataUri: string; width: number; height: number },
    personName: string,
    role: string,
  ): number => {
    const nameW = width(personName, FONT_SERIF, 'normal', 19);
    const roleW = width(role.toUpperCase(), MONO, 'normal', 11.5, 11.5 * 0.05);
    const colW = Math.max(nameW, roleW);

    // Real signature: bottom-left aligned in the slot above the name.
    const aspect = sig.width / sig.height;
    let h = 3.6 / 100 * W; // 3.6cqw, same as the web certificate
    let w = h * aspect;
    const maxW = 14 / 100 * W;
    if (w > maxW) { w = maxW; h = w / aspect; }
    doc.addImage(sig.dataUri, 'PNG', colX * k, (sigSlotBottom - h) * k, w * k, h * k, undefined, 'FAST');

    text(personName, colX, nameTop + 19 * 0.98, { font: FONT_SERIF, style: 'normal', size: 19, color: INK_900 });
    stroke(LINE_ON_PAPER, 1);
    doc.line(colX * k, roleTop * k, (colX + colW) * k, roleTop * k);
    text(role.toUpperCase(), colX, roleTop + 1 + 6 + 11.5 * 1.025, {
      font: MONO, style: 'normal', size: 11.5, color: INK_600, spacing: 11.5 * 0.05,
    });
    return colW;
  };

  const col1W = drawSignature(padX, SIGNATURE_SOHAIL, 'Mr. Muhammad Sohail', 'Founder and CEO');
  drawSignature(padX + col1W + 56, SIGNATURE_SEHAR, 'Ms. Sehar Waheed', 'Co-CEO');

  // =========================== RIGHT COLUMN ==================================
  const rPadY = rightW * 0.07;
  const rPadX = rightW * 0.06;
  const rContentW = rightW - rPadX * 2;
  const rcx = leftW + rightW / 2;

  // ---- seal: 36% of content width, 6% top margin, viewBox 100 --------------
  const sealSize = rContentW * 0.36;
  const sealTop = rPadY + rContentW * 0.06;
  const su = sealSize / 100;
  const sx = rcx - sealSize / 2, sy = sealTop;
  const S = (v: number) => v * su;

  fill(GOLD_300);
  doc.circle((sx + S(50)) * k, (sy + S(50)) * k, S(47) * k, 'F');
  stroke(GOLD_500, S(1.5));
  doc.circle((sx + S(50)) * k, (sy + S(50)) * k, S(47) * k, 'S');
  fill([255, 255, 255]);
  doc.circle((sx + S(50)) * k, (sy + S(50)) * k, S(33) * k, 'F');

  // Curved lettering on the gold ring (radius 40, 8-unit mono bold).
  const ringText = (str: string, spacing: number, top: boolean) => {
    const fs = 8;
    const adv = fs * 0.6 + spacing; // IBM Plex Mono advance = 0.6em
    const step = adv / 40;
    const n = str.length;
    doc.setFont(MONO, 'bold');
    doc.setFontSize(S(fs) * k);
    doc.setTextColor(NAVY_950[0], NAVY_950[1], NAVY_950[2]);
    for (let i = 0; i < n; i++) {
      const off = i - (n - 1) / 2;
      const phi = top ? -Math.PI / 2 + off * step : Math.PI / 2 - off * step;
      const ux = top ? Math.cos(phi) : -Math.cos(phi);
      const uy = top ? Math.sin(phi) : -Math.sin(phi);
      const tx = top ? -Math.sin(phi) : Math.sin(phi);
      const ty = top ? Math.cos(phi) : -Math.cos(phi);
      const pcx = 50 + 40 * Math.cos(phi), pcy = 50 + 40 * Math.sin(phi);
      const chW = fs * 0.6;
      const bx = pcx - (chW / 2) * tx - fs * 0.375 * ux;
      const by = pcy - (chW / 2) * ty - fs * 0.375 * uy;
      const angleDeg = -(Math.atan2(ty, tx) * 180) / Math.PI;
      doc.text(str[i], (sx + S(bx)) * k, (sy + S(by)) * k, { angle: angleDeg });
    }
  };
  ringText('VERIFIED', 1.5, true);
  ringText('CERTIFICATE', 1, false);

  // Stars (navy-800): 11-unit at 3 and 9 o'clock, 6.5-unit at the four diagonals.
  const star = (cx: number, cy: number, fs: number) => {
    const R = fs * 0.46, r = R * 0.4;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? R : r;
      pts.push([S(cx + rr * Math.cos(a)), S(cy + rr * Math.sin(a))]);
    }
    const rel: Array<[number, number]> = [];
    for (let i = 1; i < pts.length; i++) rel.push([(pts[i][0] - pts[i - 1][0]) * k, (pts[i][1] - pts[i - 1][1]) * k]);
    fill(NAVY_800);
    doc.lines(rel, (sx + pts[0][0]) * k, (sy + pts[0][1]) * k, [1, 1], 'F', true);
  };
  star(90, 50, 11); star(10, 50, 11);
  star(87.6, 36.3, 6.5); star(12.4, 36.3, 6.5); star(12.4, 63.7, 6.5); star(87.6, 63.7, 6.5);

  // Centre mark
  stroke(NAVY_800, S(2.2));
  rect(sx + S(40), sy + S(40), S(15), S(15), 'S');
  stroke(GOLD_500, S(2.2));
  rect(sx + S(45), sy + S(45), S(15), S(15), 'S');

  // ---- bottom group: verify box + id + link, anchored to the bottom --------
  const linkStr = `thepsychologysquare.com/certificates/${args.certId}`;
  const verifyUrl = certificateVerifyUrl(args.certId);
  const linkSize = 8.5;
  const linkW = width(linkStr, MONO, 'normal', linkSize);

  // Real QR encoding the verification URL. 92 design px (~2.8px per module,
  // ~0.6mm on A4) is large enough to scan reliably from a printed page; the
  // white box supplies the >=4-module quiet zone the spec requires.
  const qr = buildQrMatrix(verifyUrl);
  const QR_SIZE = 92, QR_PAD = 12;
  const boxW = Math.min(Math.max(linkW, 200), rContentW);
  const boxH = QR_SIZE + QR_PAD * 2 + 2; // qr + padding + borders
  const metaH = 10 + 10.5 * 1.6 + 2 + linkSize * 1.6;
  const groupTop = H - rPadY - (boxH + metaH);
  const boxX = rcx - boxW / 2;

  fill([255, 255, 255]);
  stroke(LINE_ON_WHITE, 1);
  rect(boxX, groupTop, boxW, boxH, 'FD');

  const qrX = boxX + 1 + QR_PAD, qrY = groupTop + 1 + QR_PAD, cell = QR_SIZE / qr.size;
  fill(NAVY_950);
  // Dark modules are merged into horizontal runs and bled by a hair so PDF
  // viewers' anti-aliasing can't leave light seams between adjacent rects.
  const bleed = 0.12;
  for (const [c, r, len] of qrRuns(qr)) {
    rect(qrX + c * cell - bleed, qrY + r * cell - bleed, len * cell + bleed * 2, cell + bleed * 2, 'F');
  }
  // Clicking the QR in a PDF viewer opens the same page a scan would.
  if (typeof doc.link === 'function') {
    doc.link(qrX * k, qrY * k, QR_SIZE * k, QR_SIZE * k, { url: verifyUrl });
  }

  const vtX = qrX + QR_SIZE + 12;
  const vtLH = 11 * 1.4;
  const vtTop = groupTop + boxH / 2 - vtLH;
  text('VERIFY', vtX, vtTop + (vtLH - 11 * 1.3) / 2 + 11 * 1.025, { font: MONO, style: 'bold', size: 11, color: INK_900, spacing: 11 * 0.03 });
  text('AUTHENTICITY', vtX, vtTop + vtLH + (vtLH - 11 * 1.3) / 2 + 11 * 1.025, { font: MONO, style: 'bold', size: 11, color: INK_900, spacing: 11 * 0.03 });

  const idTop = groupTop + boxH + 10;
  text(args.certId, rcx, idTop + (10.5 * 1.6 - 10.5 * 1.3) / 2 + 10.5 * 1.025, { font: MONO, style: 'normal', size: 10.5, color: PAPER_50, align: 'center' });
  const linkTop = idTop + 10.5 * 1.6 + 2;
  const linkBase = linkTop + (linkSize * 1.6 - linkSize * 1.3) / 2 + linkSize * 1.025;
  text(linkStr, rcx, linkBase, { font: MONO, style: 'normal', size: linkSize, color: PAPER_50, align: 'center' });
  // underline, as on the web link
  stroke(PAPER_50, 0.6);
  doc.line((rcx - linkW / 2) * k, (linkBase + 1.6) * k, (rcx + linkW / 2) * k, (linkBase + 1.6) * k);
  // clickable, like the web link
  if (typeof doc.link === 'function') {
    doc.link((rcx - linkW / 2) * k, linkTop * k, linkW * k, linkSize * 1.6 * k, { url: verifyUrl });
  }
}
