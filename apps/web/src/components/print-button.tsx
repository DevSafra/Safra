'use client';

/**
 * «تحميل PDF» — the receipt as a file (Bashar, 2026-08-11).
 *
 * ## What this actually does, said plainly
 *
 * It opens the browser's print dialog, where "Save as PDF" is the destination on every current
 * browser. It is not an `<a download>` pointing at a `.pdf` on the server, and the difference is worth
 * being honest about: the customer picks the destination rather than getting a file straight into
 * their downloads folder.
 *
 * That is a deliberate trade, and the reason is Arabic. A PDF generated in the API would be built by
 * `pdfkit` or `pdf-lib`, and neither does contextual glyph shaping or bidirectional layout — Arabic
 * would come out as disconnected, left-to-right letterforms. It would look perfect to anyone testing
 * in English and be unusable for the primary audience. Correct Arabic needs a real text engine, so the
 * choice is the customer's browser or a headless one of ours; the browser is already here, already has
 * the fonts, and costs nothing on a request path with a 200 ms budget.
 *
 * `docs/FUTURE-WORK.md` O-fin-2 records what the server-side version needs and why it belongs with the
 * deployment work rather than here.
 *
 * ## Why a button and not an anchor
 *
 * There is no URL to navigate to. `window.print()` is an action on the current document, so a
 * `<button type="button">` is the honest element — an anchor with `href="#"` would be a link that goes
 * nowhere and would put a stray `#` in the address bar.
 *
 * It hides itself when printing: a control that cannot be pressed on paper is ink spent on nothing.
 */
export function PrintButton({ label }: { readonly label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-10 w-fit cursor-pointer items-center gap-2 rounded-lg border border-gold px-4 text-sm text-gold transition-colors hover:bg-gold hover:text-bg print:hidden lg:min-h-0 lg:py-2"
    >
      {/*
        `aria-hidden`, so the accessible name is the label alone. A screen reader announcing the glyph
        before the word adds nothing, and the glyph is decoration for a control that already says what
        it does.
      */}
      <span aria-hidden="true">⤓</span>
      {label}
    </button>
  );
}
