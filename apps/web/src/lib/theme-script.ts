/**
 * Re-exported from `@safra/ui`, where the staff console reads it too.
 *
 * Kept as a module rather than deleted because `next.config.ts` and `ThemeScript` both point
 * here, and because the reason it must be ONE constant is worth stating at the point somebody
 * would otherwise be tempted to inline it: the CSP has to hash these exact bytes.
 */
export { THEME_SCRIPT } from '@safra/ui';
