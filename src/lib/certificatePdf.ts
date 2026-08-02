// Server-side certificate PDF, generated at issuance time so it can be
// attached to the "you passed" email immediately. jsPDF is pure JS (no
// canvas/DOM dependency for text-only documents like this), so the same
// package works fine inside a Cloudflare Worker.
//
// Deliberately mirrors the layout of the client-side "Download PDF" button
// on /certificates/[id].astro — same fonts, same positions, same colors —
// so the emailed PDF and the one a learner downloads later look identical.

import { jsPDF } from 'jspdf';

export interface CertificatePdfArgs {
  name: string;
  courseTitle: string;
  ceHours: number;
  scorePercent: number;
  date: string; // already formatted, e.g. "August 2, 2026"
  certId: string;
}

export function generateCertificatePdfBase64(args: CertificatePdfArgs): string {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const centerX = pageWidth / 2;

  const gold: [number, number, number] = [199, 164, 74];
  const ink: [number, number, number] = [19, 26, 34];
  const inkLight: [number, number, number] = [75, 87, 96];

  doc.setDrawColor(...gold);
  doc.setLineWidth(1.5);
  doc.rect(24, 24, pageWidth - 48, pageHeight - 48);

  doc.setTextColor(...gold);
  doc.setFont('times', 'bold');
  doc.setFontSize(13);
  doc.text('THE PSYCHOLOGY SQUARE', centerX, 80, { align: 'center' });

  doc.setTextColor(...ink);
  doc.setFont('times', 'bold');
  doc.setFontSize(32);
  doc.text('Certificate of Completion', centerX, 120, { align: 'center' });

  doc.setFont('times', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(...inkLight);
  doc.text('This certifies that', centerX, 165, { align: 'center' });

  doc.setFont('times', 'bolditalic');
  doc.setFontSize(28);
  doc.setTextColor(...ink);
  doc.text(args.name, centerX, 200, { align: 'center' });

  doc.setFont('times', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(...inkLight);
  doc.text('has successfully completed', centerX, 230, { align: 'center' });

  doc.setFont('times', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...ink);
  doc.text(args.courseTitle, centerX, 260, { align: 'center' });

  doc.setFont('times', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(...inkLight);
  doc.text(`Score: ${args.scorePercent}%      Hours: ${args.ceHours}      Date: ${args.date}`, centerX, 300, { align: 'center' });

  doc.setFontSize(10);
  doc.text(`Certificate ID: ${args.certId}`, centerX, pageHeight - 50, { align: 'center' });
  doc.text(`thepsychologysquare.com/certificates/${args.certId}`, centerX, pageHeight - 36, { align: 'center' });

  // jsPDF's Worker-safe output: base64 string, no Buffer/Blob needed.
  return doc.output('datauristring').split(',')[1];
}
