'use client';

import { useState } from 'react';

import { ImageSliderFrame, type SliderLabels } from '@safra/ui';

export interface PropertyMapImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

/**
 * The location map on a property page (O-web-12).
 *
 * ## An AREA, not a door
 *
 * Booking.com's reference draws a teardrop pin on the building. This draws a disc,
 * and the difference is the one rule this feature exists inside: the coordinates
 * behind it are rounded to about 100 m and the street address is withheld until a
 * booking is confirmed (P-001). A pin is a claim of precision we deliberately do not
 * have — it would point at a specific roof, and a reader would believe it. A disc
 * says "somewhere in here", which is exactly what we know.
 *
 * The disc is drawn INTO the image by the API (`areaPolygon`), not laid over it here.
 * A CSS overlay was the first attempt and it was wrong in a way only the browser
 * showed: the enlarged view renders through `ImageSliderFrame`, which owns its `<img>`
 * and has no slot for an overlay, so the mark appeared on the card and vanished the
 * moment somebody pressed the button to look closer.
 *
 * ## Why the button opens a picture rather than a map
 *
 * «اعرض على الخريطة» opens a LARGER RENDERING of the same area in the shared slider
 * frame, not a pannable map. Panning and zooming toward the door is the one thing the
 * rounding is there to prevent, so an interactive map would have to re-implement that
 * restriction; a second static image cannot break it. It also keeps the page free of a
 * map library — the whole card is one `<img>` — which is what §3's payload budget buys
 * on a page that already carries fourteen photographs.
 */
export function PropertyMap({
  card,
  full,
  labels,
  showLabel,
  alt,
}: {
  readonly card: PropertyMapImage;
  readonly full: PropertyMapImage;
  readonly labels: SliderLabels;
  readonly showLabel: string;
  readonly alt: string;
}) {
  const [at, setAt] = useState<number | null>(null);

  /**
   * A map that fails to load removes itself.
   *
   * MapTiler can answer slowly or refuse, and the API turns every one of those into a
   * 404. Left alone the browser paints its broken-image glyph inside the location card,
   * which reads as a defect in the listing rather than a missing decoration. Dropping
   * the figure returns the card to exactly what it looked like before this feature.
   */
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <figure className="relative border-t border-line">
      <img
        src={card.url}
        width={card.width}
        height={card.height}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="block h-48 w-full object-cover sm:h-56 lg:h-64"
      />

      <button
        type="button"
        onClick={() => setAt(0)}
        className="btn-gold absolute bottom-3 left-1/2 -translate-x-1/2 cursor-pointer rounded-full px-4 py-2 text-sm font-bold shadow-[var(--shadow-lift)] transition-[transform,box-shadow] duration-150 ease-out-strong hover:shadow-[var(--shadow-lift-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[0.97] motion-reduce:transition-none"
      >
        {showLabel}
      </button>

      {/*
        One image, so the frame's arrows never render — `previous` and `next` are carried
        because `SliderLabels` requires them, not because a reader can reach them.

        `thumb` and `full` are the same URL: the filmstrip does not render for a single
        picture, so there is no separate thumbnail for it to ask for.
      */}
      <ImageSliderFrame
        images={[{ id: 'map', thumb: full.url, full: full.url }]}
        at={at}
        onChange={setAt}
        labels={labels}
      />
    </figure>
  );
}
