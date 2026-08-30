'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** One picture in a slider. `id` keys it; `thumb` is the tile and `full` is what the frame shows. */
export interface SliderImage {
  readonly id: string;
  readonly thumb: string;
  readonly full: string;
  /** Shown under the frame — a file name, a room, whatever names this picture. */
  readonly caption?: string | undefined;
  /** A short pill beside the caption: «الغلاف», «من العميل». */
  readonly badge?: string | undefined;
}

/**
 * Every word the slider says, from the caller's own catalogue.
 *
 * Required rather than defaulted, for the reason `PasswordField` gives: a default here would be an
 * English string living in a shared package, invisible to the task of adding a language.
 */
export interface SliderLabels {
  /** The dialog's accessible name — «صور العقار», «أدلة النزاع». */
  readonly title: string;
  /** Prefixes a tile's accessible name: «معاينة ٣». */
  readonly open: string;
  readonly previous: string;
  readonly next: string;
  readonly close: string;
}

/**
 * The one image previewer — «معاينة».
 *
 * ## Why there is exactly one of these
 *
 * Standing instruction from Bashar (2026-08-30): a slider is built ONCE and used everywhere. Before
 * it, four surfaces showed photographs four ways — the console's property review had a real
 * lightbox, dispute evidence opened a raw file in a new tab, the partner's image manager had
 * thumbnails and nothing else, and the customer's property page had its own gallery. Each one
 * learnt keyboard handling, focus and scroll-locking separately, or did not learn them at all.
 *
 * ## Two exports, because half the callers draw their own tiles
 *
 * `ImageSlider` is tiles plus the frame, for a plain gallery. `ImageSliderFrame` is the frame
 * alone, for a caller whose tiles carry controls of their own — dispute evidence puts «استبدال»
 * and «حذف» under each photograph, and an ad creative has exactly one picture and a form around
 * it. Both share this file's keyboard, focus and scroll behaviour, which is the whole point.
 *
 * ## Keyboard first, and the arrows are NOT mirrored
 *
 * Arrows move, Escape closes, and the buttons carry the same actions for a pointer. An arrow key
 * means the physical direction of travel through a list, not a reading direction: somebody pressing
 * → on an Arabic screen expects the next picture, and mirroring here would make the keyboard
 * disagree with itself when the same person opens the customer site.
 */
export function ImageSliderFrame({
  images,
  at,
  onChange,
  labels,
}: {
  readonly images: readonly SliderImage[];
  /** The index being shown, or `null` when the frame is closed. */
  readonly at: number | null;
  readonly onChange: (at: number | null) => void;
  readonly labels: SliderLabels;
}) {
  const frame = useRef<HTMLDivElement>(null);

  const close = useCallback(() => onChange(null), [onChange]);

  const step = useCallback(
    (by: number) => {
      if (at === null || images.length === 0) return;

      /* Wraps, so «التالي» on the last picture returns to the first rather than dead-ending. */
      onChange((at + by + images.length) % images.length);
    },
    [at, images.length, onChange],
  );

  useEffect(() => {
    if (at === null) return undefined;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    };

    document.addEventListener('keydown', onKey);

    /* The page behind must not scroll while a full-screen frame is over it. */
    const previous = document.body.style.overflow;

    document.body.style.overflow = 'hidden';

    /*
      Focus moves INTO the frame, and the element that had it is remembered so it can be given back.
      A reader who opens a picture with the keyboard and closes it should be where they were, not at
      the top of the document.
    */
    const returnTo = document.activeElement;

    frame.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      if (returnTo instanceof HTMLElement) returnTo.focus();
    };
  }, [at, close, step]);

  /*
    Both narrowed together, so the frame renders only when there is an index AND a picture at it.
    Reading `at` below is then safe without a second null check.
  */
  const current = at === null ? undefined : images[at];

  if (current === undefined || at === null) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={labels.title}
      /* The backdrop closes, which is what everybody tries first. */
      onClick={close}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      <div
        ref={frame}
        tabIndex={-1}
        /* Clicks inside the frame must not reach the backdrop's handler. */
        onClick={(event) => event.stopPropagation()}
        className="relative flex max-h-full max-w-5xl flex-col gap-2 outline-none"
      >
        {/* `alt=""`: the picture IS the content, and a description invented here would be a claim
            about somebody's room that nobody made. The caption below names it. */}
        <img
          src={current.full}
          alt=""
          className="max-h-[80vh] rounded-lg object-contain"
        />

        <div className="flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-text">
          <span className="flex flex-wrap items-center gap-2">
            {/* The position, so a reader knows how much is left. */}
            <span dir="ltr">{`${at + 1} / ${images.length}`}</span>
            {current.caption ? (
              <span className="text-[11.5px] text-text2">{current.caption}</span>
            ) : null}
            {current.badge ? (
              <span className="rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-gold">
                {current.badge}
              </span>
            ) : null}
          </span>

          <span className="flex gap-2">
            {/* Only where there is somewhere to go: one picture needs no arrows. */}
            {images.length > 1 ? (
              <>
                <Control onClick={() => step(-1)} label={labels.previous} glyph="‹" />
                <Control onClick={() => step(1)} label={labels.next} glyph="›" />
              </>
            ) : null}
            <Control onClick={close} label={labels.close} glyph="×" />
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Tiles that open the frame — the plain gallery, for a caller with nothing else to draw.
 *
 * `renderBadge` puts a marker on a TILE (the console marks the cover photograph); the frame shows
 * `badge` for the picture it is displaying, because at full size a tile's corner is off screen.
 */
export function ImageSlider({
  images,
  labels,
  tileClassName = 'h-24 w-32',
}: {
  readonly images: readonly SliderImage[];
  readonly labels: SliderLabels;
  /** The tile size, so a dense card and a review screen can differ without a second component. */
  readonly tileClassName?: string;
}) {
  const [at, setAt] = useState<number | null>(null);

  if (images.length === 0) return null;

  return (
    <>
      <ul className="mt-3 flex flex-wrap gap-2">
        {images.map((image, index) => (
          <li key={image.id} className="relative">
            <button
              type="button"
              onClick={() => setAt(index)}
              aria-label={`${labels.open} ${index + 1}`}
              className="block cursor-pointer"
            >
              <img
                src={image.thumb}
                alt=""
                loading="lazy"
                className={`${tileClassName} rounded-lg border border-line object-cover`}
              />
            </button>
            {image.badge ? (
              <span className="pointer-events-none absolute start-1 top-1 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-gold">
                {image.badge}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <ImageSliderFrame images={images} at={at} onChange={setAt} labels={labels} />
    </>
  );
}

/**
 * One control in the frame's bar.
 *
 * The glyph is decorative and the accessible name comes from `aria-label`: «›» read aloud is not an
 * instruction, and these three buttons would otherwise be indistinguishable to a screen reader.
 */
function Control({
  onClick,
  label,
  glyph,
}: {
  readonly onClick: () => void;
  readonly label: string;
  readonly glyph: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="min-h-10 min-w-10 cursor-pointer rounded-lg border border-line bg-card px-3 text-text lg:min-h-0"
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}
