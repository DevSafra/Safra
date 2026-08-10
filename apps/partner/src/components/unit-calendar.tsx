import type { PartnerPropertyDetail, UnitCalendarDay } from '@/lib/api';
import { amount, count, marketToday } from '@/lib/format';
import { DayLegend, MonthGrid } from '@/components/month-grid';
import { RangeEditor } from '@/components/range-editor';
import { fill, t } from '@/lib/strings';

/**
 * تقويم الإتاحة — one unit's month, and the editor that changes a span of it.
 *
 * ## What is here and what is not
 *
 * Almost nothing, now. The grid is `MonthGrid` and the form is `RangeEditor`, both shared with
 * التقويمات, which shows every unit's month on one page. This composes them for a single unit and
 * adds the unit's own heading.
 *
 * Sharing them is not tidiness: two copies of the range editor would drift, and the field that
 * drifts is the one whose ABSENCE means "leave it alone" — which is how a price-only edit silently
 * reopened closed dates once already. A server component now, because the only interactive part
 * moved into `RangeEditor`.
 */
export function UnitCalendar({
  property,
  unitId,
  month,
  days,
}: {
  readonly property: PartnerPropertyDetail;
  readonly unitId: string;
  /** `YYYY-MM`, the month being displayed. Owned by the URL so the view is shareable. */
  readonly month: string;
  readonly days: readonly UnitCalendarDay[];
}) {
  const unit = property.units.find((candidate) => candidate.id === unitId);

  if (!unit) return <p className="text-[12.5px] text-faint">{t.unitCalendar.noUnits}</p>;

  const first = days[0]?.date ?? `${month}-01`;
  const last = days[days.length - 1]?.date ?? first;

  /*
    Today where the BUSINESS is, not in UTC. Rendered on the server on every request — the page is
    `force-dynamic` — and `marketToday()` is why it is not `toISOString().slice(0, 10)`.
  */
  const today = marketToday();

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[13px] font-bold text-text">{unit.nameAr}</p>
        <p className="text-[11.5px] text-faint" dir="ltr">
          {amount(unit.basePrice, unit.currencyCode)} {t.unitCalendar.perNight}
        </p>
        <p className="text-[11.5px] text-faint">
          {t.unitCalendar.minNightsShort} {count(unit.minNights)}
        </p>
      </div>

      <MonthGrid
        days={days}
        currencyCode={unit.currencyCode}
        caption={fill(t.calendars.gridCaption, { unit: unit.nameAr, month })}
        today={today}
      />

      <DayLegend />

      <RangeEditor unitId={unitId} first={first} last={last} />
    </div>
  );
}
