// Server-side certificate PDF, generated at issuance time so it can be
// attached to the "you passed" email immediately. jsPDF is pure JS (no
// canvas/DOM dependency for text-only documents like this), so the same
// package works fine inside a Cloudflare Worker.
//
// The actual drawing lives in certificateLayout.ts and is shared with the
// client-side "Download PDF" button on /certificates/[id].astro — same
// function, same fonts, same positions, same colors — so the emailed PDF
// and the one a learner downloads later are guaranteed to match, not just
// visually similar.

import { jsPDF } from 'jspdf';
import { drawCertificate, type CertificatePdfArgs } from './certificateLayout';

export type { CertificatePdfArgs };

export function generateCertificatePdfBase64(args: CertificatePdfArgs): string {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  drawCertificate(doc, args);
  // jsPDF's Worker-safe output: base64 string, no Buffer/Blob needed.
  return doc.output('datauristring').split(',')[1];
}
