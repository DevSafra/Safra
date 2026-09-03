'use client';

import { useState } from 'react';

import { ImageSliderFrame, type SliderImage, type SliderLabels } from '@safra/ui';

/** One tile in the mosaic: the sources the pipeline produced, plus what to say about it. */
export interface GalleryTile {
  readonly id: string;
  readonly avif: string;
  readonly webp: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
}

/**
 * «صور العقار» — the mosaic, and the way into the whole set.
 *
 * ## The shape is booking.com's, because Bashar asked for it
 *
 * (2026-09-02, with their Arabic property page as the reference.) One tall photograph at the
 * reading START, two stacked beside it, and a row of smaller ones underneath whose LAST tile
 * carries «+N صورة». It is worth saying why that arrangement rather than a neat grid of equals: a
 * booking decision is made on ONE photograph — the one that says what the place feels like — and a
 * grid of six equal tiles has no opinion about which that is. The mosaic makes the cover four times
 * the size of everything else and then admits there is more.
 *
 * The count sits on the LAST tile, not the first. In reading order it is the end of the row, which
 * is where «and more» belongs; on booking.com's own Arabic page it is the leftmost tile for exactly
 * that reason.
 *
 * ## Every tile opens, not just a button
 *
 * The grid used to be server-rendered `children` with a single «عرض كل الصور» control floating over
 * it, so eleven photographs of fourteen were reachable only through one small button in a corner.
 * Each tile is now a control that opens the previewer AT ITS OWN PICTURE, which is what a person
 * expects when they press a photograph of the bathroom.
 *
 * **Being a Client Component costs nothing here.** Next renders these to HTML on the server like
 * anything else, and the `<picture>` with its AVIF source is preserved verbatim — so the cover is
 * still the page's largest paint, still eager, still served in the format the pipeline produced.
 * The earlier note claiming this had to stay server-rendered to protect LCP was wrong about the
 * mechanism, and it cost the gallery its clickable tiles.
 */
export function PropertyGallery({
  images,
  tiles,
  labels,
  viewAllLabel,
  alt,
}: {
  readonly images: readonly SliderImage[];
  readonly tiles: readonly GalleryTile[];
  readonly labels: SliderLabels;
  /** Already interpolated by the caller — `fill` lives on the server side of this boundary. */
  readonly viewAllLabel: string;
  /** The property's name, for a tile whose own alt text nobody wrote. */
  readonly alt: string;
}) {
  const [at, setAt] = useState<number | null>(null);

  if (tiles.length === 0) return null;

  const hero = tiles[0];
  const stacked = tiles.slice(1, 3);
  const strip = tiles.slice(3, 8);
  /* What the last tile of the strip has to admit to. */
  const beyond = tiles.length - (3 + strip.length);

  return (
    <>
      {/*
        `aspect-[16/10]` on the block rather than a pixel height, so the mosaic keeps its proportions
        from a phone to a 2560px screen and reserves its space before the photographs arrive — a
        gallery that resizes when its images load is the single biggest source of layout shift on a
        page like this.
      */}
      <div className="mt-6 grid gap-2">
        {/*
          `7/3`, not `16/9`. A 16/9 block is 630px tall in this column and pushes the price, the
          dates and every word about the place below the fold on a laptop — the photographs are the
          reason somebody stops, and the rest is the reason they book. booking.com's own block is
          about 2.4:1 for the same reason.
        */}
        <div className="grid aspect-[7/3] gap-2 sm:grid-cols-[1.55fr_1fr]">
          {hero ? (
            <Tile
              tile={hero}
              alt={alt}
              label={`${labels.open} 1`}
              onOpen={() => setAt(0)}
              eager
              className="h-full"
            />
          ) : null}

          {/*
            Two rows when there are two, one when there is one. `grid-rows-2` with a single
            photograph leaves the bottom half of the column empty beside a full-height cover, which
            reads as an image that failed to load rather than as a listing with two photographs.
          */}
          {stacked.length > 0 ? (
            <div
              className={`hidden gap-2 sm:grid ${stacked.length > 1 ? 'grid-rows-2' : 'grid-rows-1'}`}
            >
              {stacked.map((tile, index) => (
                <Tile
                  key={tile.id}
                  tile={tile}
                  alt={alt}
                  label={`${labels.open} ${index + 2}`}
                  onOpen={() => setAt(index + 1)}
                  className="h-full"
                />
              ))}
            </div>
          ) : null}
        </div>

        {strip.length > 0 ? (
          <ul className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            {strip.map((tile, index) => (
              <li key={tile.id} className="aspect-[4/3]">
                <Tile
                  tile={tile}
                  alt={alt}
                  label={`${labels.open} ${index + 4}`}
                  onOpen={() => setAt(index + 3)}
                  className="h-full"
                  /*
                    The overlay goes on the LAST tile and only when something is actually behind it.
                    A «+0 صورة» is the kind of label that makes a person distrust every other number
                    on the page.
                  */
                  {...(index === strip.length - 1 && beyond > 0
                    ? { overlay: viewAllLabel }
                    : {})}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <ImageSliderFrame images={images} at={at} onChange={setAt} labels={labels} />
    </>
  );
}

/**
 * One photograph in the mosaic, and the control that opens it.
 *
 * The zoom on hover is 500ms and only on a real pointer: it is the one piece of motion on this page
 * that exists purely to say «this is pressable», and a touch device fires hover on tap, which would
 * leave a tile stuck mid-zoom after somebody had already opened the previewer.
 */
function Tile({
  tile,
  alt,
  label,
  onOpen,
  overlay,
  eager = false,
  className = '',
}: {
  readonly tile: GalleryTile;
  readonly alt: string;
  readonly label: string;
  readonly onOpen: () => void;
  readonly overlay?: string;
  readonly eager?: boolean;
  readonly className?: string;
}) {
  return (
    <button
      type="button"
      /* A seam that is not a word — see the rail's `data-thumb` for why a label cannot be one. */
      data-gallery-tile=""
      onClick={onOpen}
      aria-label={label}
      className={`group relative block w-full cursor-pointer overflow-hidden rounded-card border border-line outline-none transition-[box-shadow] duration-200 ease-out-strong focus-visible:ring-2 focus-visible:ring-gold ${className}`}
    >
      <picture>
        {/* AVIF first, WebP as the fallback — both produced by the upload pipeline. */}
        <source srcSet={tile.avif} type="image/avif" />
        <source srcSet={tile.webp} type="image/webp" />
        <img
          src={tile.webp}
          alt={tile.alt || alt}
          width={tile.width}
          height={tile.height}
          loading={eager ? 'eager' : 'lazy'}
          className="size-full object-cover transition-transform duration-500 ease-out-strong group-hover:[@media(hover:hover)and(pointer:fine)]:scale-[1.04]"
        />
      </picture>

      {overlay ? (
        <span className="absolute inset-0 grid place-items-center bg-black/55 text-sm font-bold text-white backdrop-blur-[1px] transition-colors duration-200 group-hover:bg-black/45">
          {overlay}
        </span>
      ) : null}
    </button>
  );
}
