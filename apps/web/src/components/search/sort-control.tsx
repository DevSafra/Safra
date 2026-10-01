'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * «ترتيب حسب» as booking.com draws it: one control, the choice in the URL.
 *
 * A real `<select>` rather than a custom listbox — it is the platform's own picker on a phone,
 * keyboard-complete everywhere, and announced correctly without a line of ARIA. Changing it
 * navigates to the href the SERVER built for that order, so the URL stays shareable and nothing
 * here assembles a query string from the current location.
 */
export function SortControl({
  label,
  value,
  options,
  compact = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; href: string }[];
  /** The phone bar's version: no visible label, the select fills its slot. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label
      className={`flex items-center gap-2 text-14 text-muted ${compact ? 'min-w-0 flex-1' : ''}`}
    >
      <span className={compact ? 'sr-only' : 'shrink-0'}>{label}</span>
      <span className="relative min-w-0 flex-1">
        <select
          value={value}
          aria-busy={pending}
          onChange={(event) => {
            const target = options.find((option) => option.value === event.target.value);
            if (target)
              startTransition(() => router.push(target.href, { scroll: false }));
          }}
          className="min-h-10 w-full cursor-pointer appearance-none rounded-lg border border-line bg-field pe-9 ps-3 text-14 font-semibold text-text transition-[border-color] duration-150 ease-out hover:border-gold/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
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
          className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-faint"
        >
          <path d="m7 10 5 5 5-5" />
        </svg>
      </span>
    </label>
  );
}
