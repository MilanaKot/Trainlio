/**
 * Where to go after signing in, from a `?next=` that came back through Google.
 *
 * Only a path on this site: `/moje-treninky`, never `https://evil.example`,
 * `//evil.example` (a protocol-relative URL) or `/\evil.example`, which some
 * browsers read as one. Anything else is the home page. An open redirect on a
 * sign-in callback hands a phishing page a link that starts with our domain.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith('/')) return '/'
  if (value.startsWith('//') || value.startsWith('/\\')) return '/'
  if (/[\u0000-\u001f]/.test(value)) return '/'
  return value
}
