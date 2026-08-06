// Single source of truth for the certificate PDF's visual layout.

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
  date: string; // e.g. "August 2, 2026"
  certId: string;
  ceHours?: number;
  scorePercent?: number;
}

// Brand palette
const GOLD: [number, number, number] = [199, 164, 74];
const SAGE: [number, number, number] = [124, 152, 133];
const INK: [number, number, number] = [19, 26, 34];
const INK_LIGHT: [number, number, number] = [75, 87, 96];
const NAVY_TEXT: [number, number, number] = [28, 49, 76];
const PAPER: [number, number, number] = [248, 249, 246];
const LINE: [number, number, number] = [214, 209, 197];

const MONO = 'IBMPlexMono';
const FONT_SERIF = 'Fraunces';
const FONT_SANS = 'Inter';

type PdfLike = any;

let fontsRegistered = false;
function ensureFontsRegistered(doc: PdfLike) {
  doc.addFileToVFS('IBMPlexMono-Regular.ttf', FONT_MONO_REGULAR_BASE64);
  doc.addFont('IBMPlexMono-Regular.ttf', MONO, 'normal');
  doc.addFileToVFS('IBMPlexMono-Bold.ttf', FONT_MONO_BOLD_BASE64);
  doc.addFont('IBMPlexMono-Bold.ttf', MONO, 'bold');

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

  const cornerInset = innerInset + 15;
  const cornerSize = 11;
  [
    [cornerInset, cornerInset],
    [pageWidth - cornerInset, cornerInset],
    [cornerInset, pageHeight - cornerInset],
    [pageWidth - cornerInset, pageHeight - cornerInset],
  ].forEach(([x, y]) => drawMark(doc, x, y, cornerSize));

  // ---- Fixed top block --------------------------------------------------
  const logoY = 54;
  drawMark(doc, centerX, logoY, 20);

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
  const footerY = pageHeight - innerInset - 8;
  const sigRoleY = footerY - 24;
  const sigNameY = sigRoleY - 15;
  const sigLineY = sigNameY - 12;
  const sigMaxH = 28;
  const sigBottomGap = 5;
  const sigImgBottomY = sigLineY - sigBottomGap;

  // ---- Dynamic vertical centering calculations --------------------------
  const maxTextWidth = pageWidth * 0.88;
  const label1 = 'This certifies that';
  const label2 = 'has successfully completed';
  const label1H = 15;
  const label2H = 15;
  const dateH = 15;
  const gapSmall = 6;
  const gapMed = 9;

  const baseNameSize = pageWidth * 0.03004;
  const baseCourseSize = pageWidth * 0.02361;
  const minNameSize = 11;
  const minCourseSize = 9;

  // Total height available strictly between the header gold rule and signature line
  const availableZoneHeight = sigLineY - topBlockBottom;

  function measure(nameSize: number, courseSize: number) {
    doc.setFont(FONT_SERIF, 'bold');
    doc.setFontSize(nameSize);
    const nameLines: string[] = doc.splitTextToSize(args.name, maxTextWidth);
    doc.setFont(FONT_SERIF, 'bold');
    doc.setFontSize(courseSize);
    const courseLines: string[] = doc.splitTextToSize(args.courseTitle, maxTextWidth);
    
    const blockHeight =
      label1H + gapSmall +
      nameLines.length * (nameSize * 1.2) + gapMed +
      label2H + gapSmall +
      courseLines.length * (courseSize * 1.22) + gapMed +
      dateH;

    return { nameLines, courseLines, blockHeight };
  }

  let nameSize = baseNameSize;
  let courseSize = baseCourseSize;
  let { nameLines, courseLines, blockHeight } = measure(nameSize, courseSize);

  // Shrink font size dynamically if content exceeds available space
  while (blockHeight > availableZoneHeight - 20 && nameSize > minNameSize && courseSize > minCourseSize) {
    nameSize -= 0.5;
    courseSize -= 0.4;
    ({ nameLines, courseLines, blockHeight } = measure(nameSize, courseSize));
  }

  const nameLineH = nameSize * 1.2;
  const courseLineH = courseSize * 1.22;

  // Vertically center the content block exactly inside the middle zone
  let cursorY = topBlockBottom + (availableZoneHeight - blockHeight) / 2;

  // ---- Render Centered Content ------------------------------------------
  doc.setFont(FONT_SANS, 'normal');
  doc.setFontSize(12.5);
  doc.setTextColor(...INK_LIGHT);
  doc.text(label1, centerX, cursorY + label1H * 0.75, { align: 'center' });
  cursorY += label1H + gapSmall;

  doc.setFont(FONT_SERIF, 'bold');
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

  doc.setFont(MONO, 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...INK_LIGHT);
  doc.text(`Issued ${args.date}`, centerX, cursorY + dateH * 0.72, { align: 'center' });

  // ---- Signatures ---------------------------------------------------------
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

    doc.setFont(FONT_SANS, 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...INK);
    doc.text(personName, colX, sigNameY, { align: 'center' });

    doc.setFont(MONO, 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...NAVY_TEXT);
    doc.text(role.toUpperCase(), colX, sigRoleY, { align: 'center' });
  };

  drawSignature(centerX - 118, SIGNATURE_SOHAIL, 'Muhammad Sohail', 'CEO');
  drawSignature(centerX + 118, SIGNATURE_SEHAR, 'Sehar Waheed', 'Co-CEO');

  // ---- Footer -----------------------------------------------------------
  const footerMarginLeft = innerInset + 35;
  const footerMarginRight = pageWidth - innerInset - 35;

  doc.setFont(MONO, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...INK_LIGHT);
  doc.text(`Certificate ID: ${args.certId}`, footerMarginLeft, footerY, { align: 'left' });
  doc.text(`thepsychologysquare.com/certificates/${args.certId}`, footerMarginRight, footerY, { align: 'right' });
}
