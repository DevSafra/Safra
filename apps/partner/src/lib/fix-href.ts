/**
 * Where each gap is actually FIXED.
 *
 * ## The defect this replaces
 *
 * Every gap linked to `/properties/{reference}` — **a route that does not exist**. A partner who
 * read «لا تظهر على الخريطة» and pressed the link meant to fix it landed on «هذه الصفحة غير
 * موجودة». It shipped twice: once with the location warning and again when that warning grew into
 * four. Nothing could see it — the type checker cannot know which paths Next serves, and no test
 * had followed the link. `tools/page-links` now sweeps for the class.
 *
 * ## Why per-gap and not one link
 *
 * The editor is a long form. «بلا صور» belongs on الصور, a different screen entirely, and the
 * other three are three different places on one page. Sending everybody to the top and letting
 * them hunt is the same half-feature the card's own comment says it exists to avoid — the fragment
 * is what makes the prompt finish its sentence.
 *
 * An unknown check falls back to the editor, which is a real route and the likeliest home for
 * whatever it turns out to be.
 */
export const FIX_HREF: Readonly<Record<string, (reference: string) => string>> = {
  unit: (reference) => `/properties/${encodeURIComponent(reference)}/edit#units`,
  location: (reference) => `/properties/${encodeURIComponent(reference)}/edit#location`,
  photograph: (reference) => `/properties/${encodeURIComponent(reference)}/images`,
  description: (reference) =>
    `/properties/${encodeURIComponent(reference)}/edit#description`,
};

export function fixHref(gap: string, reference: string): string {
  return (
    FIX_HREF[gap]?.(reference) ?? `/properties/${encodeURIComponent(reference)}/edit`
  );
}
