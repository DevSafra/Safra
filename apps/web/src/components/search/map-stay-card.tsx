'use client';

import { StarRating } from '@safra/ui';

import { OrnamentField } from '@/components/ornament';
import type { MapStay } from '@/lib/search-cards';

import { SaveHeart } from './save-heart';

/**
 * A stay in the list beside the full map: the result card's facts at a third of its width.
 *
 * Pointing at it lights its pill on the map, and pointing at a pill lights it here, so the reader
 * can tell which price belongs to which photograph without reading coordinates.
 *
 * The name is the link, STRETCHED over the card, rather than the card being one `<a>`: the card
 * carries the heart (Bashar, 2026-10-01), and a button inside a link is two controls fighting over
 * one press. The heart sits above the stretched link, as it does on the list's own cards, so a
 * press on it saves and a press anywhere else opens the stay.
 */
export function MapStayCard({
  stay,
  lit,
  onHighlight,
  newTabLabel,
  signInHref,
}: {
  stay: MapStay;
  lit: boolean;
  onHighlight: (slug: string | null) => void;
  /** Said to a screen reader, because the card opens the stay in a new tab. */
  newTabLabel: string;
  /** Where a signed-out reader goes to save, built by the server. */
  signInHref: string;
}) {
  return (
    <article
      id={`map-stay-${stay.key}`}
      onPointerEnter={() => onHighlight(stay.slug)}
      onPointerLeave={() => onHighlight(null)}
      className={`group relative grid grid-cols-[6rem_minmax(0,1fr)] gap-3 rounded-card border bg-card p-2.5 transition-[border-color,box-shadow] duration-200 ease-out-strong hover:border-gold hover:shadow-[var(--shadow-lift)] has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-gold ${
        lit ? 'border-gold shadow-[var(--shadow-lift)]' : 'border-line'
      }`}
    >
      <div className="relative aspect-square overflow-hidden rounded-lg bg-band">
        {stay.image ? (
          <img
            src={stay.image.webp}
            alt={stay.image.alt}
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-500 ease-out-strong group-hover:scale-[1.04] motion-reduce:transition-none"
          />
        ) : (
          <OrnamentField
            id={`ornament-map-${stay.key}`}
            className="text-gold-read opacity-30"
          />
        )}
      </div>

      <div className="flex min-w-0 flex-col">
        <h3 className="pe-11 text-15 leading-snug">
          <a
            href={stay.href}
            /* A new tab, so the map and the area the reader found stay where they were. */
            target="_blank"
            rel="noopener"
            onFocus={() => onHighlight(stay.slug)}
            onBlur={() => onHighlight(null)}
            className="line-clamp-2 font-bold text-text after:absolute after:inset-0 after:rounded-card after:content-[''] group-hover:text-gold-read focus-visible:outline-none"
          >
            {stay.name}
            <span className="sr-only">{newTabLabel}</span>
          </a>
        </h3>
        {stay.starRating && stay.starLabel ? (
          <span className="mt-0.5">
            <StarRating value={stay.starRating} label={stay.starLabel} />
          </span>
        ) : null}
        <p className="mt-0.5 truncate text-12 text-muted">{stay.typeLine}</p>

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          {stay.review ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-md rounded-es-none bg-indigo text-12 font-bold tabular-nums text-bg">
                {stay.review.score}
              </span>
              {stay.review.word ? (
                <span className="text-12 font-semibold text-text">
                  {stay.review.word}
                </span>
              ) : null}
            </span>
          ) : stay.newListing ? (
            <span className="text-12 font-semibold text-sky">{stay.newListing}</span>
          ) : (
            <span />
          )}
          <p className="text-end leading-tight tabular-nums">
            <span className="block text-16 font-bold text-text">{stay.nightly}</span>
            <span className="text-11 text-muted">{stay.perNight}</span>
          </p>
        </div>
      </div>

      {/* Above the stretched link, so a press on the heart saves rather than opens the stay. */}
      <div className="absolute end-2 top-2 z-10">
        <SaveHeart
          slug={stay.slug}
          initiallySaved={stay.saved}
          signInHref={signInHref}
          labels={stay.labels}
        />
      </div>
    </article>
  );
}
