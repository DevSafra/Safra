import Link from 'next/link';

import { BreadcrumbChevron } from '@/components/icons';

/**
 * The trail above a page — one design on every page that has one (Bashar, 2026-10-01: the property
 * page's trail «same as the one on the الإقامات page», with «the arrow … big and nice»).
 *
 * Five pages drew their own: «الإقامات» as a list with sky links and a small chevron, and the
 * property, city, landmark and group-trip pages as faint text with the larger drawn chevron. Two
 * looks for one control is a reader learning it twice, so there is one now: the list, the link
 * colour and the bold current page from «الإقامات», the drawn `BreadcrumbChevron` from the others.
 *
 * - **A list**, because a trail is an ordered set of places; `aria-current` names where you are.
 * - **Every link is a CONTROL**, so it carries the 40px floor below `lg` — `inline-flex` with it,
 *   because `min-height` does nothing to an inline element.
 * - **The current page truncates** on a phone rather than wrapping the trail onto a second line
 *   under a long hotel name; its full text is still the element's own, for a screen reader.
 * - **The chevron follows the document's direction** — see `BreadcrumbChevron` for why that is not
 *   a prop.
 */
export function Breadcrumb({
  label,
  items,
  className = '',
}: {
  /** The landmark's accessible name, from the catalogue. */
  label: string;
  /** In reading order; the LAST is the current page and has no link. */
  items: readonly { label: string; href?: string | undefined }[];
  className?: string;
}) {
  return (
    <nav aria-label={label} className={`text-14 text-muted ${className}`}>
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li
              key={`${index}-${item.label}`}
              className={`flex items-center gap-x-1.5 ${last ? 'min-w-0' : ''}`}
            >
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="inline-flex min-h-10 items-center text-sky underline-offset-4 transition-colors duration-150 ease-out hover:text-gold-read hover:underline lg:min-h-0"
                >
                  {item.label}
                </Link>
              ) : (
                <span aria-current="page" className="truncate font-bold text-text">
                  {item.label}
                </span>
              )}
              {last ? null : (
                <span aria-hidden className="inline-flex items-center text-15 text-faint">
                  <BreadcrumbChevron />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
