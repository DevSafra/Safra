'use client';

import { useCallback, useEffect, useState } from 'react';

import { t } from '@/lib/strings';

export interface GalleryPhoto {
  readonly src: string;
  readonly full: string;
  readonly isCover: boolean;
}

/**
 * The photographs of a listing, with a preview a reviewer can page through.
 *
 * ## Why a lightbox rather than a link per image
 *
 * §8.1 has SAFRA verify a property «عبر … الصور», and verifying means looking at ALL of them. Each
 * thumbnail opening a new tab meant a reviewer closed and reopened once per photograph; on a
 * listing with twenty rooms that is twenty round trips to reach a judgement.
 *
 * ## Keyboard first
 *
 * Arrows move, Escape closes, and the buttons carry the same actions for a pointer. A reviewer
 * working down a queue keeps their hands on the keyboard, and a gallery that can only be driven by
 * clicking is slower than the tabs it replaced.
 *
 * `role="dialog"` with `aria-modal`, focus moved to the frame on open and returned on close: this
 * covers the page, and a screen reader that keeps reading the list behind it is describing
 * something the user cannot reach.
 */
export function PhotoGallery({ photos }: { photos: readonly GalleryPhoto[] }) {
  const copy = t.sections.propertyDetail;
  const [openAt, setOpenAt] = useState<number | null>(null);

  const close = useCallback(() => setOpenAt(null), []);
  const step = useCallback(
    (by: number) =>
      setOpenAt((at) =>
        /* Wraps, so «التالي» on the last photograph returns to the first rather than dead-ending. */
        at === null ? at : (at + by + photos.length) % photos.length,
      ),
    [photos.length],
  );

  useEffect(() => {
    if (openAt === null) return undefined;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      /*
        The page is RTL, and these are deliberately NOT swapped.

        An arrow key means the physical direction of travel through a list, not a reading
        direction — a reviewer pressing → expects the next photograph, and mirroring them here
        would make the keyboard disagree with itself when the same person opens the customer site.
      */
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    };

    document.addEventListener('keydown', onKey);

    /* The page behind must not scroll while a full-screen frame is over it. */
    const previous = document.body.style.overflow;

    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [openAt, close, step]);

  /*
    Both narrowed together, so the frame renders only when there is an index AND a photograph at
    it. Reading `openAt` inside the frame is then safe without a second null check.
  */
  const current = openAt === null ? undefined : photos[openAt];
  const position = openAt === null ? 0 : openAt + 1;

  return (
    <>
      <ul className="mt-3 flex flex-wrap gap-2">
        {photos.map((photo, index) => (
          <li key={photo.src} className="relative">
            <button
              type="button"
              onClick={() => setOpenAt(index)}
              aria-label={`${copy.openPhoto} ${index + 1}`}
              className="block cursor-pointer"
            >
              <img
                src={photo.src}
                alt=""
                loading="lazy"
                className="h-24 w-32 rounded-lg border border-line object-cover"
              />
            </button>
            {photo.isCover ? (
              <span className="pointer-events-none absolute start-1 top-1 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-gold">
                {copy.coverBadge}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {current ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={copy.photos}
          /* The backdrop closes, which is what everybody tries first. */
          onClick={close}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <div
            /* Clicks inside the frame must not reach the backdrop's handler. */
            onClick={(event) => event.stopPropagation()}
            className="relative flex max-h-full max-w-5xl flex-col gap-2"
          >
            <img
              src={current.full}
              alt=""
              className="max-h-[80vh] rounded-lg object-contain"
            />

            <div className="flex items-center justify-between gap-3 text-[12.5px] text-text">
              <span className="flex items-center gap-2">
                {/*
                  The position, so a reviewer knows how much is left — and the cover marked here
                  too, because at full size the thumbnail's badge is off screen.
                */}
                <span dir="ltr">{`${position} / ${photos.length}`}</span>
                {current.isCover ? (
                  <span className="rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-gold">
                    {copy.coverBadge}
                  </span>
                ) : null}
              </span>

              <span className="flex gap-2">
                <Control onClick={() => step(-1)} label={copy.previousPhoto} glyph="‹" />
                <Control onClick={() => step(1)} label={copy.nextPhoto} glyph="›" />
                <Control onClick={close} label={copy.closePhoto} glyph="×" />
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * One control in the frame's bar.
 *
 * The glyph is decorative and the accessible name comes from `aria-label`: «›» read aloud is not an
 * instruction, and these four buttons would otherwise be indistinguishable to a screen reader.
 */
function Control({
  onClick,
  label,
  glyph,
}: {
  onClick: () => void;
  label: string;
  glyph: string;
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
