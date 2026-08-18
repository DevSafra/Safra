/**
 * Re-exported from `@safra/ui`, where the staff console reads it too.
 *
 * Kept as a module rather than deleted because `next.config.ts` and `ThemeScript` both point
 * here, and because the reason it must be ONE constant is worth stating at the point somebody
 * would otherwise be tempted to inline it: the CSP has to hash these exact bytes.
 */
import { themeScript } from '@safra/ui';

/** This app's copy of the pre-paint script, namespaced to the `web` surface. */
export const THEME_SCRIPT = themeScript('web');
