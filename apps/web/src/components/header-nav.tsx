'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The header's primary destinations, with the current one marked.
 *
 * Bashar, 2026-09-03: «the navbar menu item should be activated when I am on its page.» It is also
 * what `design_handoff_safra` does — sampled from the prototype in the light theme, the current
 * item is `--gold` at 13.5px/600 and the others are `--muted` at the same size. The header used to
 * carry a note saying an active state was not worth a client component for two links; the design
 * asks for it, so the note was wrong.
 *
 * ## `usePathname`, not a header set in middleware
 *
 * The footer's language picker learnt this the hard way: `x-safra-pathname` is absent on any path
 * containing a dot and stale in a cached render. The browser knows where it is.
 *
 * ## What counts as «here»
 *
 * The home link matches only its own path — `/ar` — because a `startsWith` test would light it up
 * on every page of the site. Everything else matches its own subtree, so `/ar/search?citySlug=…`
 * and a future `/ar/search/…` both mark الإقامات.
 *
 * `aria-current="page"` carries the same fact to a screen reader, which colour alone cannot.
 *
 * ## The space before it
 *
 * `ms-3` on top of the header row's own `gap-x-5` — 32px between the wordmark and the first item,
 * which is what the prototype's header sets (`gap:20px` on the row, `margin-inline-start:12px` on
 * the nav). It had 8px and no margin, and the menu read as part of the logo (Bashar, 2026-09-03:
 * «the menu items on the navbar are too close to the logo»). A logical property, so the English
 * and German pages get the mirror of this rather than a copy.
 */
export function HeaderNav({
  links,
  label,
}: {
  readonly links: readonly { href: string; label: string }[];
  readonly label: string;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="me-auto ms-3 flex items-center gap-1">
      {links.map((link, index) => {
        /* The first link is the locale root; the rest own their subtree. */
        const here =
          index === 0
            ? pathname === link.href
            : pathname === link.href || pathname.startsWith(`${link.href}/`);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={here ? 'page' : undefined}
            className={`inline-flex min-h-10 items-center rounded-lg px-3 py-2 text-[13.5px] font-semibold transition-colors sm:min-h-11 ${
              here ? 'text-gold' : 'text-muted hover:bg-gold/10 hover:text-text'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
