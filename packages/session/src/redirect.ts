/**
 * Narrows a `?next=` parameter to a path on this site.
 *
 * An unchecked redirect target on a sign-in form is the classic open redirect: a
 * link to `safra.com/login?next=https://evil.example` shows SAFRA's own domain and
 * its real login form, then hands the customer to somebody else immediately after
 * they authenticate. It is worth guarding precisely because the page around it looks
 * completely legitimate.
 *
 * Only a same-site absolute PATH survives. Everything else falls back to the
 * customer's home page for their locale:
 *
 *  - `//evil.example` — protocol-relative, which a naive "starts with /" check lets
 *    straight through. This is the case such checks usually miss.
 *  - `https://evil.example` — absolute URL.
 *  - `/\evil.example` — backslashes, which some browsers normalise to slashes.
 *  - anything not starting with a single `/`.
 */
export function safeRedirect(
  value: string | string[] | undefined,
  locale: string,
): string {
  const fallback = `/${locale}`;
  const candidate = Array.isArray(value) ? value[0] : value;

  if (!candidate) return fallback;

  // Reject anything with a scheme or an authority before parsing.
  if (!candidate.startsWith('/')) return fallback;
  if (candidate.startsWith('//')) return fallback;
  if (candidate.includes('\\')) return fallback;

  /**
   * Parsed against a throwaway origin to confirm it stays there.
   *
   * The string checks above cover the known shapes; this catches whatever encoding
   * trick they do not, because a target that resolves to another origin cannot
   * survive the comparison however it was spelled.
   */
  try {
    const base = 'https://safra.invalid';
    const resolved = new URL(candidate, base);

    if (resolved.origin !== base) return fallback;

    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return fallback;
  }
}
