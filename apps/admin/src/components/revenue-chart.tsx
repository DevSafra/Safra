import { AR } from '@/lib/strings';

/** Weekday names, indexed by `Date.getUTCDay()`. */
const WEEKDAYS = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;

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
    <div className="rounded-[15px] border border-[rgba(var(--goldA),0.14)] bg-card p-4.5">
      {/* `h2` like every other panel title, so the console has one heading outline. */}
      <h2 className="text-[14.5px] font-extrabold text-gold">{AR.admin.weekRevenue}</h2>
      <p className="mt-1 mb-3.5 text-[11px] text-faint">{AR.admin.weekRevenueSub}</p>

      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="block w-full"
        role="img"
        aria-label={AR.admin.weekRevenue}
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
            {index === series.length - 1 ? AR.admin.today : weekday(point.day)}
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
