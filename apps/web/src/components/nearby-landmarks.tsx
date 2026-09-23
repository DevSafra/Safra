'use client';

import { useState } from 'react';

import { LandmarkIcon, type LandmarkKind } from './landmark-icon';

export interface LandmarkEntry {
  readonly slug: string;
  readonly kind: LandmarkKind;
  readonly name: string;
  /**
   * Already written out — «١٫٢ كم» — because the page that renders it is a Server
   * Component and this one is not.
   *
   * React refuses to serialise a function across that boundary, so passing a formatter
   * down is a 500 at request time that every type check and every build reports as fine.
   * The distances are all known on the server anyway, and formatting them there keeps
   * `Intl` and the catalogue on the side that already holds the locale.
   */
  readonly distanceLabel: string;
  /** Metres, for ordering and for nothing a reader sees. */
  readonly distanceMetres: number;
}

export interface NearbyLandmarkLabels {
  readonly title: string;
  readonly intro: string;
  readonly showAll: string;
  readonly showFewer: string;
  readonly kinds: Readonly<Record<LandmarkKind, string>>;
}

/** How many rows show before the list asks to be opened. */
const COLLAPSED_ROWS = 6;

/**
 * «ما حول العقار» — what this listing is near, and how far.
 *
 * ## The intro line is not decoration
 *
 * Every distance here is measured from the listing's PUBLISHED area, which is a ~100 m
 * rounding of where it really is, and then rounded again to 100 m steps. A reader who takes
 * «٨٠٠ م» as a promise about the front door will be wrong by up to a block, so the sentence
 * above the list says what the number is measured from. The privacy model is a product fact
 * here rather than an implementation detail, and the page states it.
 *
 * ## Why a flat list and not a card per kind
 *
 * Eight kinds would be eight cards of icon-plus-heading-plus-text, which is the lazy page
 * scaffold the craft floor names first. The question a guest is asking is «how close is this
 * to things», and that is one ordered list — nearest first, the kind carried by its mark and
 * its label rather than by a container.
 */
export function NearbyLandmarks({
  entries,
  labels,
}: {
  readonly entries: readonly LandmarkEntry[];
  readonly labels: NearbyLandmarkLabels;
}) {
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) return null;

  const shown = expanded ? entries : entries.slice(0, COLLAPSED_ROWS);
  const hidden = entries.length - shown.length;

  return (
    <div className="border-t border-line p-5">
      <h3 className="font-display text-base text-text">{labels.title}</h3>
      <p className="mt-1 text-12 text-faint">{labels.intro}</p>

      {/*
        Two columns from `sm` up. A single column of eleven rows on a laptop is a narrow
        ribbon down a wide card, and the reader's eye has to travel the whole height to
        compare two distances.
      */}
      <ul className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {shown.map((entry) => (
          <li key={entry.slug} className="flex items-start gap-2.5">
            <LandmarkIcon kind={entry.kind} className="mt-0.5 shrink-0 text-gold-read" />
            <span className="min-w-0 flex-1">
              <span className="block text-14 text-text">{entry.name}</span>
              <span className="block text-12 text-faint">{labels.kinds[entry.kind]}</span>
            </span>
            {/*
              `tabular-nums` so a column of distances lines up on the decimal rather than
              shimmering — the craft floor's note about numerals in data shipping with a
              browser default that belongs to no design system.
            */}
            <span className="shrink-0 text-13 tabular-nums text-muted">
              {entry.distanceLabel}
            </span>
          </li>
        ))}
      </ul>

      {hidden > 0 || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="mt-4 inline-flex min-h-10 cursor-pointer items-center text-13 font-bold text-gold-read underline-offset-4 transition-colors hover:underline lg:min-h-0"
        >
          {expanded ? labels.showFewer : labels.showAll}
        </button>
      ) : null}
    </div>
  );
}
