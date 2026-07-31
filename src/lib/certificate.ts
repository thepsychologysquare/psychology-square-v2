// Certificate ID generator — same shape/alphabet as makeReference() in
// api/bookings.ts, just with a CERT- segment so the two are never
// ambiguous at a glance.

export function makeCertificateId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `TPS-CERT-${code}`;
}
