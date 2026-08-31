/**
 * Re-exported so the customer app's `@/lib/bidi` imports stay as they are.
 *
 * The function itself moved to `@safra/i18n` when the staff console needed it to write «120 دقيقة»
 * without the unit and the number swapping places. The reasoning lives with it there.
 */
export { ltrIsolate } from '@safra/i18n';
