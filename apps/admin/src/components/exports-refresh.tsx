'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Re-reads الملفات المصدَّرة while anything is still being built, and stops when nothing is.
 *
 * ## Why the copy alone was not enough
 *
 * The screen's footnote says «حدّث الصفحة بعد قليل» — refresh in a moment — and that is honest but
 * weak. An operator who asked for an export is standing in front of a row that says «في الانتظار»
 * with no way to tell the difference between "a worker is on it" and "nothing is running". The
 * common outcome of that is a second request for the same file, which is another full scan of the
 * bookings table.
 *
 * Same treatment as the partner's image manager, for the same reason: work moved off the request,
 * so the screen has to close the loop the response used to close.
 *
 * ## Conditional, and that is the whole design
 *
 * `pending` is false as soon as every row is `ready` or `failed`, and then this renders nothing and
 * schedules nothing. An unconditional interval would be every open exports page in the estate
 * re-rendering on the server every few seconds, forever, to learn that nothing changed.
 *
 * Three seconds rather than the image manager's two: an export is a database scan measured in
 * seconds to minutes, not a single image encode, so a faster poll would mostly catch itself.
 */
export function ExportsRefresh({ pending }: { readonly pending: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!pending) return;

    const timer = setTimeout(() => router.refresh(), 3_000);

    return () => clearTimeout(timer);
    /*
      `pending` is recomputed from freshly fetched rows on every refresh, so this effect re-arms
      itself for as long as it is true and falls silent the moment it is not.
    */
  }, [pending, router]);

  return null;
}
