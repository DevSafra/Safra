import { headers } from 'next/headers';

import { THEME_SCRIPT } from '@/lib/theme-script';

/**
 * Applies the saved theme BEFORE first paint.
 *
 * This has to be a blocking inline script. Doing it in an effect would render the dark
 * default first and then repaint to light — a visible flash on every load for anyone who
 * chose the light theme.
 *
 * The nonce is read from the Content-Security-Policy that middleware set on this
 * request. Next stamps its OWN inline scripts automatically but cannot know about one
 * rendered by hand, so without this the script is the single blocked resource on an
 * otherwise clean page — and the symptom is a theme flash, which nobody would connect
 * to a CSP.
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
