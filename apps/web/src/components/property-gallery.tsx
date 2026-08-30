'use client';

import { useState } from 'react';

import { ImageSliderFrame, type SliderImage, type SliderLabels } from '@safra/ui';

/**
 * «عرض كل الصور» — the customer's way into the whole set.
 *
 * ## What it fixes
 *
 * The gallery grid shows a cover and two thumbnails, which is right for the page's first paint and
 * wrong as the only thing a person can see: a listing with fourteen photographs published eleven
 * that nobody could reach. Bashar made one previewer a rule on 2026-08-30; this is that previewer,
 * not a fourth gallery.
 *
 * ## The grid stays SERVER-rendered
 *
 * The cover is this page's largest paint, and it is a `<picture>` with AVIF and WebP sources the
 * pipeline produced. Moving it into a client component to make the tiles clickable would trade a
 * measured LCP for a convenience — so the grid is passed through as `children` and this adds a
 * control over it, plus the frame.
 */
export function PropertyGallery({
  images,
  labels,
  viewAllLabel,
  children,
}: {
  readonly images: readonly SliderImage[];
  readonly labels: SliderLabels;
  /** Already interpolated by the caller — `fill` lives on the server side of this boundary. */
  readonly viewAllLabel: string;
  readonly children: React.ReactNode;
}) {
  const [at, setAt] = useState<number | null>(null);

  return (
    <div className="relative">
      {children}

      {images.length > 0 ? (
        <button
          type="button"
          onClick={() => setAt(0)}
          className="absolute bottom-3 end-3 inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line bg-card/90 px-4 text-sm font-semibold text-text transition-colors hover:border-gold hover:text-gold lg:min-h-0 lg:py-2"
        >
          {viewAllLabel}
        </button>
      ) : null}

      <ImageSliderFrame images={images} at={at} onChange={setAt} labels={labels} />
    </div>
  );
}
