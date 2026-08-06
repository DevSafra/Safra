import { fill, t } from '@/lib/strings';

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
  href,
  section,
}: {
  /** Built with `returnHref` from a LITERAL base path, never from the URL. */
  readonly href: string;
  /** The list's own name, e.g. `t.nav.bookings`. Announced, not drawn. */
  readonly section: string;
}) {
  return (
    <a
      href={href}
      aria-label={fill(t.table.backToLabel, { section })}
      className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-[9px] border border-line px-3.5 py-2 text-[12.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.4)] hover:text-gold lg:min-h-0"
    >
      <span aria-hidden="true">{t.table.backArrow}</span>
      <span>{t.table.back}</span>
    </a>
  );
}
