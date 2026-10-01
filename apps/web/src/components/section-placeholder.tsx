import Link from 'next/link';

import type { Locale } from '@/i18n/routing';
import { OrnamentField } from '@/components/ornament';

/**
 * A destination in the navbar that has nothing in it yet, said plainly.
 *
 * ## Why these pages exist at all
 *
 * Bashar asked for six items in the navbar (2026-09-27) and two of them — سياحة علاجية and
 * جروبات — have no product behind them: no page, no property type, no trip attribute, no entity.
 * A navbar item pointing at a route that does not exist is a 404 on the most-pressed control on
 * the site, and `tools/page-links` fails the build for it, so the destination has to exist the
 * moment the link does.
 *
 * He chose «keep it empty» for سياحة علاجية, and for جروبات «only the admin can create a group
 * trip» — which is a shape, not yet a thing that exists. So both are this: a real page that tells
 * the truth about being empty.
 *
 * ## An empty page is not a blank one
 *
 * A heading over nothing reads as a page that failed to load, which is the failure this whole
 * codebase keeps rediscovering. So it says what will be here, and it gives the reader somewhere to
 * go — the two things an empty state owes anybody who reached it on purpose.
 *
 * **It does not promise a date.** «قريباً» is a claim somebody has to keep; this says what the
 * section is for and leaves the timing to the people who decide it.
 *
 * ## It is deliberately ONE component
 *
 * Two pages with one shape is how two pages end up disagreeing about what «nothing here yet» looks
 * like. The words are the caller's, for the reason `PasswordField` and `ImageSlider` give: a
 * default sentence living in a shared component is invisible to the task of adding a language.
 */
export function SectionPlaceholder({
  locale,
  ornamentId,
  title,
  body,
  browseLabel,
  citiesLabel,
}: {
  readonly locale: Locale;
  /*
    An ASCII id, given by the caller rather than derived from the title.

    It was `ornament-placeholder-${title}`, and an SVG `<pattern>` is referenced by
    `url(#id)` — a space in an id makes that reference invalid, so «سياحة علاجية» rendered a FLAT
    BLOCK where «جروبات», which has no space, tiled correctly. Two pages, one with a space in its
    name, and only one of them looked right.
  */
  readonly ornamentId: string;
  readonly title: string;
  readonly body: string;
  readonly browseLabel: string;
  readonly citiesLabel: string;
}) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-14 sm:py-20">
      <div className="relative overflow-hidden rounded-card border border-line bg-card p-8 text-center sm:p-12">
        {/*
          The brand's ornament behind the words, at the opacity the city card uses for a
          photograph it does not have. It is the same answer to the same question — what fills a
          frame that has nothing in it — and `aria-hidden` by construction inside `OrnamentField`.
        */}
        <OrnamentField
          id={`ornament-placeholder-${ornamentId}`}
          className="absolute inset-0 text-gold-read opacity-[0.07]"
        />

        <div className="relative">
          <h1 className="font-display text-3xl text-text sm:text-4xl">{title}</h1>
          <p className="mx-auto mt-4 max-w-[58ch] text-16 leading-relaxed text-muted">
            {body}
          </p>

          {/*
            Two ways onward, because a reader who pressed a navbar item wanted to browse something.
            `min-h-11` on both: an anchor styled as a control gets the touch floor spelled out —
            `min-height` does nothing to an inline element.
          */}
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={`/${locale}/search`}
              className="inline-flex min-h-11 items-center rounded-lg btn-gold px-5 text-15 font-bold"
            >
              {browseLabel}
            </Link>
            <Link
              href={`/${locale}/city`}
              className="inline-flex min-h-11 items-center rounded-lg border border-line px-5 text-15 font-semibold text-muted transition-colors duration-200 ease-out-strong hover:border-gold/60 hover:text-gold-read"
            >
              {citiesLabel}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
