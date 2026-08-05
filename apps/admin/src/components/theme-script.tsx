import { headers } from 'next/headers';

import { THEME_SCRIPT } from '@safra/ui';

/**
 * Applies the saved theme BEFORE first paint.
 *
 * This has to be a blocking inline script. Doing it in an effect would render the dark default
 * first and repaint to light — a visible flash on every navigation for anyone who chose light.
 *
 * ## The nonce is the whole difficulty
 *
 * `middleware.ts` sets a per-request Content-Security-Policy with `script-src 'self'
 * 'nonce-…' 'strict-dynamic'`. Next stamps its OWN inline scripts with that nonce automatically
 * but cannot know about one rendered by hand, so without this the script is the single blocked
 * resource on an otherwise clean page — and the symptom is a theme flash, which nobody would
 * connect to a CSP. This console has already lost an afternoon to a CSP blocking hydration; the
 * lesson is written into the project rules.
 *
 * The policy is read back off the request headers rather than recomputed, so there is exactly
 * one nonce per request and no chance of signing the script with a different one than the header
 * advertises.
 */
export async function ThemeScript() {
  const nonce = nonceFrom((await headers()).get('content-security-policy'));

  return (
    <script
      {...(nonce ? { nonce } : {})}
      dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
    />
  );
}

/** Pulls `'nonce-…'` out of the policy. Returns null when there is none to find. */
function nonceFrom(csp: string | null): string | null {
  const match = csp ? /'nonce-([^']+)'/.exec(csp) : null;

  return match?.[1] ?? null;
}
