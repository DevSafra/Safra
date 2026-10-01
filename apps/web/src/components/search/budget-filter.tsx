'use client';

import { useEffect, useState } from 'react';

import { formatMoney } from '@/lib/localise';
import type { Locale } from '@/i18n/routing';

/**
 * «ميزانيتك (لليلة الواحدة)» — booking.com's histogram slider (Bashar, 2026-10-01).
 *
 * The bars are the real spread of NIGHTLY prices, fee included, across every stay matching the
 * reader's other filters — computed by the facet query, which deliberately ignores the budget
 * itself so the reader sees the whole range they are choosing inside. Bars inside the chosen range
 * are gold, the rest muted.
 *
 * Two native range inputs, overlaid. Native because each is then a real slider to a keyboard and a
 * screen reader with nothing to re-implement; overlaid because that is how one track gets two
 * thumbs. A value is COMMITTED on release — pointer up, key up, blur — so dragging does not fire a
 * search per pixel.
 *
 * Direction follows the document. A native range runs from the right on an RTL page, and the bars
 * are a flex row, which also starts at the right there, so the cheapest bar always sits under the
 * cheapest end of the track.
 */
export function BudgetFilter({
  locale,
  price,
  selected,
  labels,
  onCommit,
}: {
  locale: Locale;
  price: { min: string; max: string; currencyCode: string; bars: number[] };
  selected: { min: number | undefined; max: number | undefined };
  labels: {
    title: string;
    range: (min: string, max: string) => string;
    min: string;
    max: string;
    bars: string;
  };
  onCommit: (range: { min: number | null; max: number | null }) => void;
}) {
  const floor = Math.floor(Number(price.min));
  const ceiling = Math.max(floor + 1, Math.ceil(Number(price.max)));
  const step = Math.max(1, Math.round((ceiling - floor) / 100));

  const clamp = (value: number) => Math.min(ceiling, Math.max(floor, value));
  const [low, setLow] = useState(clamp(selected.min ?? floor));
  const [high, setHigh] = useState(clamp(selected.max ?? ceiling));

  /* A new search brings a new range; follow it rather than keep a stale thumb. */
  useEffect(() => {
    setLow(clamp(selected.min ?? floor));
    setHigh(clamp(selected.max ?? ceiling));
  }, [floor, ceiling, selected.min, selected.max]);

  const commit = () =>
    onCommit({
      min: low > floor ? low : null,
      max: high < ceiling ? high : null,
    });

  const money = (value: number) => formatMoney(String(value), price.currencyCode, locale);
  const tallest = Math.max(1, ...price.bars);
  const span = ceiling - floor;

  const thumb =
    'pointer-events-none absolute inset-x-0 top-0 h-6 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none ' +
    '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-card [&::-webkit-slider-thumb]:bg-gold [&::-webkit-slider-thumb]:shadow-[var(--shadow-lift)] [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-150 active:[&::-webkit-slider-thumb]:scale-110 ' +
    '[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-card [&::-moz-range-thumb]:bg-gold ' +
    'focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-gold focus-visible:[&::-webkit-slider-thumb]:ring-offset-2';

  return (
    <div role="group" aria-label={labels.title} className="grid gap-3">
      <h3 className="text-15 font-bold text-text">{labels.title}</h3>
      <p className="text-14 font-semibold tabular-nums text-text">
        {labels.range(money(low), money(high))}
      </p>

      <div role="img" aria-label={labels.bars} className="flex h-14 items-end gap-px">
        {price.bars.map((count, index) => {
          const from = floor + (span * index) / price.bars.length;
          const to = floor + (span * (index + 1)) / price.bars.length;
          const inside = to > low && from < high;
          return (
            <span
              key={index}
              className={`flex-1 rounded-t-sm transition-colors duration-200 ease-out ${inside ? 'bg-gold/70' : 'bg-line'}`}
              style={{
                height: `${Math.max(count > 0 ? 8 : 2, (count / tallest) * 100)}%`,
              }}
            />
          );
        })}
      </div>

      <div className="relative h-6">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-line" />
        {/* The chosen stretch of track, placed by LOGICAL insets so it follows the reading direction. */}
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-gold"
          style={{
            insetInlineStart: `${((low - floor) / span) * 100}%`,
            insetInlineEnd: `${((ceiling - high) / span) * 100}%`,
          }}
        />
        <input
          type="range"
          aria-label={labels.min}
          min={floor}
          max={ceiling}
          step={step}
          value={low}
          onChange={(event) => setLow(Math.min(Number(event.target.value), high - step))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          className={thumb}
        />
        <input
          type="range"
          aria-label={labels.max}
          min={floor}
          max={ceiling}
          step={step}
          value={high}
          onChange={(event) => setHigh(Math.max(Number(event.target.value), low + step))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          className={thumb}
        />
      </div>
    </div>
  );
}
