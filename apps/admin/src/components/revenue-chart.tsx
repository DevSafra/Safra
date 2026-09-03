import { CONSOLE_LOCALE, t } from '@/lib/strings';

/**
 * Weekday names, indexed by `Date.getUTCDay()`.
 *
 * Derived from `Intl` rather than written out. Seven names per language is exactly the kind of
 * copy a platform library already has, correctly, for every locale — and a catalogue entry for
 * each would be seven more strings to translate per language that could only ever be wrong.
 *
 * Verified against the design handoff before switching: `Intl` on `ar` produces الأحد …
 * السبت, the same seven names the design specifies, in the same order.
 *
 * 2026-01-04 is a Sunday, so the seven consecutive days from it land on `getUTCDay()` 0–6 in
 * order. UTC throughout, because the bars are keyed by `getUTCDay()`.
 */
const WEEKDAYS = ((): readonly string[] => {
  const format = new Intl.DateTimeFormat(CONSOLE_LOCALE, {
    weekday: 'long',
    timeZone: 'UTC',
  });

  return Array.from({ length: 7 }, (_, day) =>
    format.format(new Date(Date.UTC(2026, 0, 4 + day))),
  );
})();

const CHART_WIDTH = 280;
const CHART_HEIGHT = 120;
const BAR_WIDTH = 26;
const BAR_GAP = 12;

/**
 * The week's commission revenue, as an inline SVG bar chart.
 *
 * No charting library: seven bars and seven labels do not justify a dependency, and every
 * chart package ships either a runtime that must be nonce-allowed under the CSP or an SVG
 * builder larger than this file. Drawing seven rects is the smaller thing.
 *
 * Rendered server-side, so the panel arrives with the page rather than after a hydration
 * round trip — the dashboard is read at a glance, and a chart that pops in late is worse
 * than one that is simply there.
 */
export function RevenueChart({
  series,
}: {
  series: readonly { day: string; amount: string }[];
}) {
  const values = series.map((point) => Number(point.amount));

  /**
   * Scaled to the week's own maximum, not a fixed ceiling.
   *
   * A quiet week would otherwise render as seven invisible slivers. The floor of 1 keeps
   * an all-zero week from dividing by zero — it draws flat, which is the honest picture.
   */
  const peak = Math.max(...values, 1);

  return (
    <div className="rounded-card border border-[rgba(var(--goldA),0.14)] bg-card p-4.5">
      {/* `h2` like every other panel title, so the console has one heading outline. */}
      <h2 className="text-[14.5px] font-extrabold text-gold-ink">
        {t.admin.weekRevenue}
      </h2>
      <p className="mt-1 mb-3.5 text-[11px] text-faint">{t.admin.weekRevenueSub}</p>

      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="block w-full"
        role="img"
        aria-label={t.admin.weekRevenue}
      >
        <defs>
          <linearGradient id="safra-goldbar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#F0CB7C" />
            <stop offset="1" stopColor="#C4923E" />
          </linearGradient>
        </defs>

        {values.map((value, index) => {
          // A minimum of 2px so a zero day is still visibly a bar rather than nothing.
          const height = Math.max(2, Math.round((value / peak) * (CHART_HEIGHT - 24)));
          const isRecent = index >= values.length - 2;

          return (
            <rect
              key={series[index]?.day ?? index}
              x={10 + index * (BAR_WIDTH + BAR_GAP)}
              y={CHART_HEIGHT - 10 - height}
              width={BAR_WIDTH}
              height={height}
              rx="4"
              // The two most recent days in gold, as the design has it.
              fill={isRecent ? 'url(#safra-goldbar)' : 'var(--color-barDim)'}
            />
          );
        })}
      </svg>

      {/*
        `dir="ltr"` on the labels only. The bars are drawn left-to-right by index, so the
        labels must run the same way to stay under their own bar — the surrounding page is
        right-to-left and would otherwise reverse them.
      */}
      <div dir="ltr" className="mt-1.5 flex justify-between text-[10px] text-faint">
        {series.map((point, index) => (
          <span key={point.day} className="w-[38px] text-center">
            {index === series.length - 1 ? t.admin.today : weekday(point.day)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** `YYYY-MM-DD` to an Arabic weekday. Parsed as UTC to match the server's date. */
function weekday(day: string): string {
  const parsed = new Date(`${day}T00:00:00Z`);

  return WEEKDAYS[parsed.getUTCDay()] ?? day;
}
