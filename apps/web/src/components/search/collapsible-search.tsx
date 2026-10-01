'use client';

import { useState, type ReactNode } from 'react';

/**
 * The search bar, folded to one line on a phone (Bashar, 2026-10-01).
 *
 * On the results page the full form is four stacked fields and a button — a whole screen on a
 * 390px phone, which pushed the first result below the fold of the page whose job is results.
 * booking.com answers that with a summary of the search that opens the form, and so does this.
 *
 * From `lg` the form is always shown and the summary never is. The default is rendered by the
 * SERVER (`hidden lg:block`), so a desktop never flashes a collapsed bar and a phone never flashes
 * an open one; the script only toggles it.
 */
export function CollapsibleSearch({
  summary,
  editLabel,
  children,
}: {
  summary: string;
  editLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-card border-2 border-gold/60 bg-card px-4 py-2.5 text-start shadow-[var(--shadow-lift)] transition-[transform,border-color] duration-150 ease-out active:scale-[0.99] motion-reduce:transition-none lg:hidden ${open ? 'mb-3' : ''}`}
      >
        <span className="min-w-0 truncate text-14 font-semibold text-text">
          {summary}
        </span>
        <span className="shrink-0 text-13 font-bold text-sky">{editLabel}</span>
      </button>
      <div className={open ? 'block' : 'hidden lg:block'}>{children}</div>
    </div>
  );
}
