import Link from 'next/link';

import { ltrIsolate } from '@safra/i18n';

import type { Locale } from '@/i18n/routing';

import { ServiceIcon, type ServiceCode } from './service-icons';

/**
 * SAFRA's six services as a row of cards: what replaced «مدن تسهر معك» on the home page (Bashar,
 * 2026-10-04, screenshot «14.59.04»). Each card is the service's drawing, its Latin name, what it
 * covers in the reader's language, and a way in.
 *
 * ## Three of them have nowhere to go yet
 *
 * Rides, Umrah and Real Estate have no page. They are shown, because the row is the offer, and
 * marked «قريباً» in place of the arrow (Bashar's choice). They are not links: a card that looks
 * pressable and leads nowhere, or to a page that says nothing, is the broken-feature state this
 * codebase is not allowed to ship. The day a page exists, the card gets its `href` and the word goes.
 *
 * ## The order is the screenshot's
 *
 * Read from the right on the Arabic page, as the reference does: Real Estate first, Rides last.
 * The arrow points the way the reference draws it, physically, not mirrored per direction.
 */
export interface ServiceCardsCopy {
  readonly names: Record<ServiceCode, string>;
  readonly covers: Record<ServiceCode, string>;
  readonly soon: string;
}

/*
  One line per service, in the reference's order, with each destination written out as an `href`
  literal: `tools/page-links` reads those, and fails the build if a page behind one goes. A table
  of codes and paths read better and hid every link from it, which is how a dead link ships.
*/
export function ServiceCards({
  locale,
  copy,
}: {
  readonly locale: Locale;
  readonly copy: ServiceCardsCopy;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6">
      <ServiceCard code="realEstate" copy={copy} />
      <ServiceCard code="umrah" copy={copy} />
      <ServiceCard code="trips" copy={copy} href={`/${locale}/groups`} />
      <ServiceCard code="medical" copy={copy} href={`/${locale}/medical-tourism`} />
      <ServiceCard code="stay" copy={copy} href={`/${locale}/search`} />
      <ServiceCard code="rides" copy={copy} />
    </ul>
  );
}

const CARD =
  'flex h-full flex-col items-center rounded-card border border-line bg-card px-3 pt-5 pb-4 text-center shadow-[var(--shadow-lift)]';

function ServiceCard({
  code,
  copy,
  href,
}: {
  readonly code: ServiceCode;
  readonly copy: ServiceCardsCopy;
  /** Where the card leads. Absent: the service has no page yet, and the card is not a link. */
  readonly href?: string;
}) {
  const body = (
    <>
      {/*
        The drawing carries the card, as on the stay-type tiles: no ring, no tinted plate.
        `size-16` on a phone already reads as the subject; `sm:size-[4.5rem]` lets it lead
        where the card has room.
      */}
      <ServiceIcon code={code} className="size-16 shrink-0 sm:size-[4.5rem]" />
      <span className="mt-3 block min-w-0">
        {/* A Latin brand name on an Arabic line: isolated, so the bidi algorithm leaves it whole. */}
        <span className="block text-16 font-bold text-text sm:text-17">
          {ltrIsolate(copy.names[code])}
        </span>
        <span className="mt-1 block text-14 leading-snug text-muted">
          {copy.covers[code]}
        </span>
      </span>
      {href ? (
        <span
          aria-hidden
          className="mt-4 inline-flex size-10 items-center justify-center rounded-full bg-gold/15 text-gold-read transition-colors duration-200 ease-out-strong group-hover:bg-gold/25"
        >
          <ArrowGlyph />
        </span>
      ) : (
        <span className="mt-4 inline-flex h-10 items-center rounded-full bg-field px-4 text-13 font-semibold text-muted">
          {copy.soon}
        </span>
      )}
    </>
  );

  return (
    <li data-service={code}>
      {href ? (
        <Link
          href={href}
          className={`group ${CARD} transition-[border-color,background-color,box-shadow] duration-200 ease-out-strong hover:border-gold/60 hover:bg-gold/5 hover:shadow-[var(--shadow-lift-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-read`}
        >
          {body}
        </Link>
      ) : (
        <div className={CARD}>{body}</div>
      )}
    </li>
  );
}

/** The reference's arrow, pointing right on both pages, as drawn there. */
function ArrowGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.15rem"
      height="1.15rem"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
