import { THEME_SCRIPT } from '@/lib/theme-script';

/**
 * Applies the saved theme BEFORE first paint.
 *
 * This has to be a blocking inline script. Doing it in an effect would render the
 * dark default first and then repaint to light — a visible flash on every load for
 * anyone who chose the light theme. Small enough to be worth the inline script.
 *
 * The Content-Security-Policy admits it by HASH, not `unsafe-inline`: allowing all
 * inline script to permit one known line would hand any reflected-content bug a place
 * to execute. See `next.config.ts`, which hashes the same constant.
 */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
