import { DisclosureChevron } from '@/components/icons';
import { localisedText } from '@/lib/localise';
import type { Locale } from '@/i18n/routing';

interface FaqItem {
  readonly question: { ar: string | null; en: string | null; de: string | null };
  readonly answer: { ar: string | null; en: string | null; de: string | null };
}

/**
 * A list of questions that open to their answers.
 *
 * Used twice on a property page — the partner's answers about the listing, and SAFRA's own — so it
 * is a component rather than JSX written out twice. Two copies is how one of them comes to open on
 * click and the other on focus, which is the kind of difference nobody can name and everybody
 * feels.
 *
 * ## `<details>` and nothing else
 *
 * No state, no effect, no client boundary. The browser opens a `<details>` on click AND on Enter,
 * lets find-in-page open a closed one to show a match, and announces it to a screen reader as a
 * disclosure — all of which a `useState` accordion has to re-implement and usually does not. This
 * page is server-rendered; adding a client component for a triangle would be paying hydration for
 * something the platform does better.
 *
 * `list-style: none` removes the browser's own marker (and `::-webkit-details-marker` removes
 * Safari's, which ignores the first). What replaces it is drawn — see `DisclosureChevron`.
 *
 * ## The text is TEXT
 *
 * An answer is written by a partner and rendered on an internet-facing page. It arrives here as a
 * string and leaves as a text node: React escapes it, and nothing in this file goes near
 * `dangerouslySetInnerHTML`. That is the whole XSS story for partner-supplied FAQ content, and it
 * is why the contract's length limits are about readability rather than safety.
 *
 * `whitespace-pre-line` so a partner who pressed Enter twice gets the paragraph they typed, while
 * every other kind of whitespace still collapses — the answer is prose, not markup.
 */
export function FaqList({
  items,
  locale,
}: {
  readonly items: readonly FaqItem[];
  readonly locale: Locale;
}) {
  return (
    <ul className="mt-3 divide-y divide-line rounded-card border border-line bg-card">
      {items.map((item, index) => {
        const question = localisedText(item.question, locale);
        const answer = localisedText(item.answer, locale);

        return (
          /*
            The question is the key. An FAQ has no identifier on the wire — the API sends what to
            render, not which row it came from — and the index alone would re-key every item when
            an operator reorders them. Both together stay stable under a reorder and unique under
            a duplicate.
          */
          <li key={`${index}-${question}`}>
            <details className="group">
              <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-start text-15 text-text transition-colors hover:text-gold-read focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gold [&::-webkit-details-marker]:hidden">
                {question}
                {/*
                  Rotated rather than swapped for an «up» glyph: one element that turns reads as
                  the same control changing state, where two glyphs read as two controls. 200ms
                  ease-out is the duration on the chevron itself.
                */}
                <span className="text-faint transition-transform duration-200 ease-out group-open:rotate-180">
                  <DisclosureChevron />
                </span>
              </summary>

              <p className="whitespace-pre-line px-4 pb-4 text-sm leading-relaxed text-muted">
                {answer}
              </p>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
