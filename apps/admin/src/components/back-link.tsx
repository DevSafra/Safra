import { BackNavigation } from '@/components/back-navigation';
import type { Origin } from '@/lib/search-params';
import { fill, t } from '@/lib/strings';

/** Where the control goes; `origin` is null when it goes to this screen's own list. */
export interface BackTarget {
  readonly href: string;
  readonly origin: Origin | null;
}

/**
 * The control at the top of a detail screen that returns to the list it was opened from.
 *
 * ## Why it says «رجوع»
 *
 * It used to read «← القوائم» — "the queues" — and link to `/`, the dashboard. Two problems, both
 * reported by Bashar (2026-08-05): the word did not say where it went, and where it went was not
 * where the reader came from. Someone on page 4 of a filtered الحجوزات search opened a booking and
 * was returned to the dashboard, with the search and the page gone.
 *
 * Naming the destination — «← الحجوزات» — fixed the second problem and overshot the first: the
 * control then repeated the section the reader had just clicked out of, and grew as wide as
 * whichever name it carried. So the visible word is the ACTION, and the destination survives as
 * the accessible name, which is where a reader who cannot see the surrounding screen needs it.
 *
 * ## Why the arrow is a sibling and not part of the string
 *
 * «رجوع» is Arabic and «→» is bidi-neutral, so a single `'→ رجوع'` string does not have a
 * predictable side — the arrow lands wherever the bidi algorithm resolves it, which is how the
 * previous «←» ended up on the wrong edge of the button. As its own flex item it is placed by
 * `flex-direction: row` under `dir="rtl"`, which puts the FIRST item on the right, always. A
 * left-to-right locale then gets it on the left for free; only the glyph is a translation
 * decision, and that lives in the catalogue.
 *
 * `aria-hidden` because the arrow is not the label — the accessible name comes from `aria-label`,
 * and an unlabelled «→» read aloud says nothing.
 *
 * ## Why a plain `<a>` and not `next/link`
 *
 * This is the one control in the console that navigates to a URL whose FRAGMENT carries meaning —
 * `#row-<reference>`, so the list scrolls back to the row that was opened. `next/link` navigates
 * with `history.pushState`, and `:target` does not re-evaluate on a History API change: the
 * browser scrolled correctly and the row was left untinted, so the reader arrived somewhere with
 * nothing marked. A real navigation gets both behaviours from the browser, with no client
 * component and no JavaScript for what is a cosmetic.
 *
 * The cost is one document load instead of an RSC fetch, on a page that is `force-dynamic` and
 * hits the server either way. `e2e/detail-return.spec.ts` asserts the tint, so swapping this back
 * to `<Link>` fails rather than quietly dropping the mark again.
 *
 * ## Why it is styled as a control
 *
 * It was bare text: no border, no background, sitting alone above the reference. On a screen made
 * of bordered cards it read as a stray caption rather than the one way back. This is the same
 * outline the pagination bar's تطبيق uses, so the console has one secondary-control style rather
 * than two.
 *
 * `min-h-10` below `lg` because an anchor is inline and the global 40px touch floor — which
 * covers `button`, `select` and `summary` — cannot reach it. See `globals.css`.
 */
export function BackLink({
  target,
  section,
}: {
  /**
   * Built by `backTarget` from a LITERAL base path or a LITERAL origin prefix, never from a path
   * found in the URL — see the `ORIGINS` map, which is the security boundary here.
   */
  readonly target: BackTarget;
  /** The screen's own list, e.g. `t.nav.bookings` — used when the reader came from that list. */
  readonly section: string;
}) {
  /*
    Three destinations, three names. This screen's own list keeps the name the caller passed. An
    origin that is one RECORD is named in the singular — «الرجوع إلى الحجز», because «الحجوزات»
    would be a lie about where the control goes. An origin that is a LIST reuses that section's
    nav name, which is already the plural and already translated.
  */
  const destination =
    target.origin === null
      ? section
      : target.origin.record
        ? (t.table.backToOrigin[target.origin.key] ?? section)
        : (t.nav[target.origin.key] ?? section);

  return (
    /*
      `BackNavigation` keeps this an `<a href>` and adds one thing: on an ordinary click, if the
      previous history entry is a page of this console, it goes THERE rather than to the rebuilt
      URL. The rebuild remains the href — for no JavaScript, for a middle click, for a bookmarked
      detail page with no history behind it, and for anyone arriving from outside.

      Bashar (2026-08-24): the control must "navigate really back to the previous opened page". The
      reconstruction was always a good guess and only ever as good as whether the linking screen
      remembered to say `?from=` — which two of them do.
    */
    <BackNavigation
      href={target.href}
      ariaLabel={fill(t.table.backToLabel, { section: destination })}
      className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-[9px] border border-line px-3.5 py-2 text-[12.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.4)] hover:text-gold lg:min-h-0"
    >
      <span aria-hidden="true">{t.table.backArrow}</span>
      <span>{t.table.back}</span>
    </BackNavigation>
  );
}
