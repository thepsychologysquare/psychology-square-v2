// Only ever allow redirecting to a path on THIS site. A bare startsWith('/')
// check is not enough: '//evil.com' and '/\evil.com' both start with '/' but
// browsers treat them as another host.
export function safeRedirectPath(value: string | null | undefined, fallback: string = '/my-certificates'): string {
  if (!value || !value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (/[\r\n]/.test(value)) return fallback;
  return value;
}
