'use client';

import Link from 'next/link';

import { StarRating } from '@safra/ui';

import { OrnamentField } from '@/components/ornament';
import type { CardModel } from '@/lib/search-cards';

import { SaveHeart } from './save-heart';

/**
 * One result, laid out the way booking.com lays out a hit and the approved prototype draws one
 * (Bashar, 2026-10-01).
 *
 * Photograph at the reading START, then the facts a guest scans in order — what it is and where,
 * what room this price buys, what it promises about cancelling — and at the END the two things
 * compared across cards: what other guests thought and what it costs. Below `sm` it stacks with the
 * photograph on top, because a 390px row cannot hold three columns of Arabic.
 *
 * ## One link per card
 *
 * The whole card is the target, through a pseudo-element stretched over it from the title link —
 * the arrangement `PropertyCard` records the reasons for. «عرض التوافر» is therefore DRAWN as a
 * button but is part of that same link rather than a second one: two anchors to one place would
 * give a keyboard two stops and a screen reader the listing twice.
 *
 * Every string arrives already written by the server (`toCardModels`), so the twentieth card,
 * fetched while scrolling, reads exactly like the first.
 */
export function ResultCard({
  card,
  signInHref,
}: {
  card: CardModel;
  signInHref: string;
}) {
  return (
    <article
      id={`result-${card.key}`}
      className="group relative grid scroll-mt-28 overflow-hidden rounded-card border border-line bg-card transition-[border-color,box-shadow] duration-200 ease-out-strong hover:border-gold/50 hover:shadow-[var(--shadow-lift)] sm:grid-cols-[13.5rem_1fr] lg:grid-cols-[15rem_1fr]"
    >
      <div className="relative aspect-[3/2] overflow-hidden bg-band sm:aspect-auto sm:min-h-full">
        {card.image ? (
          <picture>
            <source srcSet={card.image.avif} type="image/avif" />
            <source srcSet={card.image.webp} type="image/webp" />
            <img
              src={card.image.webp}
              alt={card.image.alt}
              loading="lazy"
              decoding="async"
              className="size-full object-cover transition-transform duration-500 ease-out-strong group-hover:scale-[1.03] motion-reduce:transition-none"
            />
          </picture>
        ) : (
          <OrnamentField
            id={`ornament-result-${card.key}`}
            className="text-gold-read opacity-30"
          />
        )}

        {/* Above the stretched link, so a press on the heart saves rather than navigates. */}
        <div className="absolute end-2.5 top-2.5 z-10">
          <SaveHeart
            slug={card.slug}
            initiallySaved={card.saved}
            signInHref={signInHref}
            labels={card.labels}
          />
        </div>
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-[1fr_auto] md:gap-5">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={card.href}
              className="inline-flex min-h-10 items-center font-display text-18 font-bold leading-snug text-text after:absolute after:inset-0 after:content-[''] group-hover:text-gold-read focus-visible:outline-none focus-visible:after:rounded-card focus-visible:after:ring-2 focus-visible:after:ring-gold lg:min-h-0"
            >
              {card.name}
            </Link>
            {card.starRating && card.starLabel ? (
              <StarRating value={card.starRating} label={card.starLabel} />
            ) : null}
          </h3>

          <p className="mt-1 text-14 text-muted">{card.typeLine}</p>

          {card.distance ? (
            <p className="mt-1 flex items-center gap-1.5 text-13 tabular-nums text-muted">
              <PinIcon />
              {card.distance}
            </p>
          ) : null}

          {card.badges.length > 0 ? (
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {card.badges.map((badge) => (
                <li
                  key={badge}
                  className="rounded-full border border-gold/40 bg-gold/10 px-2.5 py-0.5 text-12 font-semibold text-gold-read"
                >
                  {badge}
                </li>
              ))}
            </ul>
          ) : null}

          {/*
            The room this price buys, set off by a rule on the start edge the way booking.com
            separates «what you get» from «where it is». 2px, which the craft floor allows; a
            thicker coloured bar would be a decoration rather than a separator.
          */}
          {card.unitName ? (
            <div className="mt-3 border-s-2 border-line ps-3">
              <p className="text-14 font-bold text-text">{card.unitName}</p>
              {card.unitDetails ? (
                <p className="mt-0.5 text-13 text-muted">{card.unitDetails}</p>
              ) : null}
            </div>
          ) : null}

          {card.amenities.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {card.amenities.map((amenity) => (
                <li
                  key={amenity}
                  className="rounded-full border border-line bg-field px-2.5 py-0.5 text-12 text-text2"
                >
                  {amenity}
                </li>
              ))}
            </ul>
          ) : null}

          {card.freeCancellation ? (
            <p className="mt-3 flex items-center gap-1.5 text-13 font-semibold text-ok">
              <CheckIcon />
              {card.freeCancellation}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 border-t border-line pt-3 md:w-44 md:items-end md:border-t-0 md:pt-0 md:text-end">
          {card.review ? (
            <div className="flex items-center gap-2 md:flex-row-reverse">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg rounded-es-none bg-indigo text-15 font-bold tabular-nums text-bg">
                {card.review.score}
              </span>
              <span className="leading-tight md:text-end">
                {card.review.word ? (
                  <span className="block text-14 font-bold text-text">
                    {card.review.word}
                  </span>
                ) : null}
                <span className="block text-12 text-muted">{card.review.count}</span>
              </span>
            </div>
          ) : card.newListing ? (
            <span className="w-fit rounded-full border border-sky/40 bg-sky/10 px-2.5 py-0.5 text-12 font-semibold text-sky">
              {card.newListing}
            </span>
          ) : null}

          <div className="mt-auto">
            <p className="text-12 text-muted">{card.stayFor}</p>
            <p className="mt-0.5 tabular-nums">
              <span className="text-20 font-bold text-text">{card.nightly}</span>{' '}
              <span className="text-13 text-muted">{card.perNight}</span>
            </p>
            {card.total ? (
              <p className="text-13 tabular-nums text-muted">{card.total}</p>
            ) : null}
            <p className="text-12 text-muted">{card.includesFees}</p>

            {/*
              A REAL link to the same stay, above the card's stretched one (Bashar, 2026-10-01: «the
              button is not clickable»). It was a span drawn as a button: its transform and hover filter
              gave it a paint layer of its own, ABOVE the stretched link, so a press on the one control
              that looked pressable landed on an element that went nowhere — while a press anywhere
              else on the card worked.

              Out of the tab order and hidden from assistive technology, because the title is already
              that link for a keyboard and a screen reader; this is the same destination for a pointer.
            */}
            <Link
              href={card.href}
              tabIndex={-1}
              aria-hidden
              className="btn-gold relative z-10 mt-3 inline-flex min-h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg px-4 text-14 font-bold md:w-auto"
            >
              {card.cta}
              <ChevronIcon />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

function PinIcon() {
  return (
    <svg
      aria-hidden
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-faint"
    >
      <path d="M12 21s-7-6.3-7-11.5A7 7 0 0 1 19 9.5C19 14.7 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

/** Onward through the reading direction: points left on an Arabic page, right on a Latin one. */
function ChevronIcon() {
  return (
    <svg
      aria-hidden
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 rtl:-scale-x-100"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
