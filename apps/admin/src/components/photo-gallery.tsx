'use client';

import { ImageSlider, type SliderImage } from '@safra/ui';

import { t } from '@/lib/strings';

export interface GalleryPhoto {
  readonly src: string;
  readonly full: string;
  readonly isCover: boolean;
}

/**
 * The photographs of a listing — thin, because the slider is `@safra/ui`'s.
 *
 * This file WAS the lightbox: keyboard handling, focus, scroll-locking, wrapping, the position
 * counter. All of it moved to `ImageSlider` on 2026-08-30, when Bashar made one previewer a rule —
 * dispute evidence had opened a raw file in a new tab, the partner's image manager had no preview
 * at all, and each surface would have learnt the same lessons again. What is left here is the one
 * thing that IS this screen's: which photograph is the cover.
 *
 * §8.1 has SAFRA verify a property «عبر … الصور», and verifying means looking at all of them.
 */
export function PhotoGallery({ photos }: { photos: readonly GalleryPhoto[] }) {
  const copy = t.sections.propertyDetail;

  const images: SliderImage[] = photos.map((photo, index) => ({
    id: `${photo.src}-${index}`,
    thumb: photo.src,
    full: photo.full,
    /* The badge rides on the picture, so it shows on the tile AND in the frame. */
    ...(photo.isCover ? { badge: copy.coverBadge } : {}),
  }));

  return <ImageSlider images={images} labels={t.sections.slider} />;
}
