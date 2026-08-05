import { getReports, type ReportCard } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { money, percent } from '@/lib/format';
import { ConsoleShell } from '@/components/console-shell';
import { t } from '@/lib/strings';

/**
 * التقارير (design handoff §8).
 *
 * Four cards, each with a value, a trend against the previous week, and an eight-bar sparkline
 * whose last two bars are gold — the design's exact shape.
 *
 * ## The trend arrow is computed, never stored
 *
 * The prototype hardcodes "↑ 14٪ عن حزيران". Here the direction and the magnitude both come from
 * comparing the last two buckets, because a hardcoded arrow is the easiest thing in a dashboard
 * to leave pointing the wrong way after a bad month — and a green ↑ on a falling number is worse
 * than no trend at all.
 *
 * ## Direction is not the same as good
 *
 * Revenue and occupancy rising is good; cancellations and response time rising is bad. Each card
 * declares which way is favourable, so the colour reflects the MEANING rather than the sign.
 */
export const dynamic = 'force-dynamic';

/** Whether an increase in this measure is good news. */
const HIGHER_IS_BETTER: Record<ReportCard['key'], boolean> = {
  commission_revenue: true,
  occupancy: true,
  cancellations: false,
  partner_response: false,
};

export default async function ReportsPage() {
  const [result, counts] = await Promise.all([getReports(), sidebarCounts()]);

  return (
    <ConsoleShell title={t.nav.reports} counts={counts}>
      {result === 'unauthenticated' ? (
        <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
      ) : result === 'failed' ? (
        <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
          {result.cards.map((card) => (
            <Card key={card.key} card={card} />
          ))}
        </div>
      )}
    </ConsoleShell>
  );
}

function Card({ card }: { card: ReportCard }) {
  const meta = COPY[card.key];
  const values = card.series.map((point) => Number(point.value));
  const peak = Math.max(...values, 1);

  return (
    <section className="rounded-[15px] border border-[rgba(var(--goldA),0.14)] bg-card p-4.5">
      <h2 className="text-[14px] font-extrabold text-gold">{meta.title}</h2>

      <p className="mt-3 text-2xl font-extrabold text-text">{format(card)}</p>
      <Trend card={card} />

      {/*
        56px tall bars, as the design has them. Scaled to the series' own peak: a fixed ceiling
        would render a quiet week as eight invisible slivers, and the floor of 1 keeps an
        all-zero week from dividing by zero — it draws flat, which is the honest picture.
      */}
      <div
        className="mt-3.5 flex h-14 items-end gap-1.25"
        role="img"
        aria-label={`${meta.title}: ${format(card)}`}
      >
        {values.map((value, index) => (
          <span
            key={card.series[index]?.bucket ?? index}
            /* The last two buckets in gold, matching the design's highlight of "recent". */
            className={`flex-1 rounded-t ${
              index >= values.length - 2 ? 'bg-gold' : 'bg-[var(--color-barDim)]'
            }`}
            style={{ height: `${Math.max(2, Math.round((value / peak) * 100))}%` }}
          />
        ))}
      </div>

      <p className="mt-2 text-[10.5px] leading-relaxed text-faint">{meta.sub}</p>
    </section>
  );
}

/**
 * The trend line.
 *
 * A null `previous` renders "no comparison" rather than 0% — claiming no change when there is
 * nothing to compare against is a fabrication, and the first week of any new measure hits it.
 */
function Trend({ card }: { card: ReportCard }) {
  if (card.previous === null) {
    return (
      <p className="mt-1 text-[11.5px] text-faint">{t.sections.reports.noPrevious}</p>
    );
  }

  const now = Number(card.value);
  const before = Number(card.previous);
  const delta = now - before;

  if (!Number.isFinite(delta) || Math.abs(delta) < 0.05) {
    return (
      <p className="mt-1 text-[11.5px] text-faint">— {t.sections.reports.vsPrevious}</p>
    );
  }

  const rising = delta > 0;
  const good = rising === HIGHER_IS_BETTER[card.key];

  return (
    <p className={`mt-1 text-[11.5px] ${good ? 'text-ok' : 'text-bad'}`}>
      {rising ? '↑' : '↓'} {formatDelta(card, Math.abs(delta))}{' '}
      {t.sections.reports.vsPrevious}
    </p>
  );
}

const COPY: Record<ReportCard['key'], { title: string; sub: string }> = {
  commission_revenue: {
    title: t.sections.reports.commissionRevenue,
    sub: t.sections.reports.commissionRevenueSub,
  },
  occupancy: {
    title: t.sections.reports.occupancy,
    sub: t.sections.reports.occupancySub,
  },
  cancellations: {
    title: t.sections.reports.cancellations,
    sub: t.sections.reports.cancellationsSub,
  },
  partner_response: {
    title: t.sections.reports.partnerResponse,
    sub: t.sections.reports.partnerResponseSub,
  },
};

/** Each measure has its own unit; a shared formatter would print "$71" for occupancy. */
function format(card: ReportCard): string {
  switch (card.key) {
    case 'commission_revenue':
      return `$${money(card.value)}`;
    case 'partner_response':
      return `${Number(card.value).toLocaleString('en-US')} ${t.sections.reports.minutes}`;
    default:
      return percent(card.value);
  }
}

function formatDelta(card: ReportCard, delta: number): string {
  switch (card.key) {
    case 'commission_revenue':
      return `$${money(String(delta))}`;
    case 'partner_response':
      return `${Math.round(delta).toLocaleString('en-US')} ${t.sections.reports.minutes}`;
    default:
      return percent(String(delta));
  }
}
