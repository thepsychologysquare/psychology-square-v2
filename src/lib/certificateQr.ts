// Real, scannable QR code for the paid certificate's "Verify authenticity" box.
//
// The QR encodes the certificate's public verification URL
// (https://thepsychologysquare.com/certificates/<id>). That page looks the
// certificate up live in D1, so scanning always shows the current, real
// record - a forged or mistyped ID simply lands on "Certificate not found".
// Each certificate gets its own QR because the ID is part of the encoded URL.
//
// One shared module feeds BOTH the web certificate (inline SVG, rendered on
// the server) and the PDF (vector squares drawn by certificateLayoutPaid.ts),
// so the two can never drift apart.
//
// We import qrcode's pure-JS core instead of the package root on purpose:
// the root pulls in Node-only PNG/canvas code that doesn't belong in a
// Cloudflare Worker or a browser bundle. The core only computes the module
// matrix - no DOM, no canvas, no fs.

// @ts-ignore - the core entry has no bundled type declarations
import QRCodeCore from 'qrcode/lib/core/qrcode';

export const SITE_ORIGIN = 'https://thepsychologysquare.com';

export function certificateVerifyUrl(certId: string): string {
  return `${SITE_ORIGIN}/certificates/${encodeURIComponent(certId)}`;
}

export type QrMatrix = { size: number; isDark: (row: number, col: number) => boolean };

// Error correction M (~15% recoverable): survives scuffs, small prints and
// phone-screenshot compression, while keeping the code small enough
// (version 4, 33x33 modules for our URL length) to scan from a printed A4.
export function buildQrMatrix(text: string): QrMatrix {
  const qr = QRCodeCore.create(text, { errorCorrectionLevel: 'M' });
  const size: number = qr.modules.size;
  const data: ArrayLike<number> = qr.modules.data;
  return { size, isDark: (row, col) => data[row * size + col] === 1 };
}

// Merges horizontal runs of dark modules into single rectangles so the SVG
// path and the PDF stay small (a 33x33 code is a few hundred rects, not 1000+).
export function qrRuns(m: QrMatrix): Array<[number, number, number]> {
  const runs: Array<[number, number, number]> = []; // [col, row, length]
  for (let row = 0; row < m.size; row++) {
    let col = 0;
    while (col < m.size) {
      if (!m.isDark(row, col)) { col++; continue; }
      const start = col;
      while (col < m.size && m.isDark(row, col)) col++;
      runs.push([start, row, col - start]);
    }
  }
  return runs;
}

// Inline SVG markup for the web certificate. No quiet zone here: the white
// verify box around it supplies the 4-module margin scanners need.
export function certificateQrSvg(certId: string, className = 'cp-qr'): string {
  const url = certificateVerifyUrl(certId);
  const m = buildQrMatrix(url);
  const d = qrRuns(m).map(([c, r, len]) => `M${c} ${r}h${len}v1h-${len}z`).join('');
  return (
    `<svg class="${className}" viewBox="0 0 ${m.size} ${m.size}" shape-rendering="crispEdges" ` +
    `role="img" aria-label="QR code linking to the verification page for certificate ${certId}">` +
    `<title>Scan to verify this certificate</title><path d="${d}"/></svg>`
  );
}
