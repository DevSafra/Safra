/**
 * The nonce middleware put in this request's Content-Security-Policy.
 *
 * Next stamps its OWN inline scripts automatically but cannot know about one rendered by hand, so
 * a script written in a component is the single blocked resource on an otherwise clean page — and
 * the symptom never mentions security. `ThemeScript` learnt that as a theme flash; a blocked
 * JSON-LD block would be worse, because nothing on the page changes at all and the loss shows up
 * weeks later as a rich result that never appeared.
 *
 * Shared rather than copied: this regex was written once in `theme-script.tsx`, and a second copy
 * is a second thing to get right when the policy's shape changes.
 */
export function nonceFrom(csp: string | null): string | null {
  const match = csp ? /'nonce-([^']+)'/.exec(csp) : null;

  return match?.[1] ?? null;
}
