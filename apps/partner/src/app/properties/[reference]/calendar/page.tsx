import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getProperty, getUnitCalendar, sidebarBadges } from '@/lib/api';
import { requireVerifiedPartner } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { UnitCalendar } from '@/components/unit-calendar';
import { marketToday } from '@/lib/format';
import { t } from '@/lib/strings';

/**
 * تقويم الإتاحة — one unit, one month.
 *
 * ## Why the unit and the month are in the URL
 *
 * A partner comparing two units, or looking at next season, sends somebody the link. Holding
 * either in component state would make the address bar describe a screen nobody else can reach,
 * and would lose the reader's place on every reload.
 *
 * Both are CLAMPED rather than trusted: an unknown unit falls back to the property's first, and a
 * month that does not parse falls back to this one. The unit id is additionally checked against
 * the property's OWN units, so a valid-looking id belonging to another partner's property cannot
 * be read through this screen — the API would refuse it too, and this makes the screen refuse it
 * first rather than rendering an error.
 */
export const dynamic = 'force-dynamic';

/** `YYYY-MM` for the month a date falls in. */
function monthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The first and last day of a `YYYY-MM`, as the API's `from`/`to`. */
function span(month: string): { from: string; to: string } {
  const [year, index] = month.split('-').map(Number);
  /* Day zero of the NEXT month is the last day of this one, so leap years need no special case. */
  const end = new Date(Date.UTC(year ?? 1970, index ?? 1, 0));

  return {
    from: `${month}-01`,
    to: `${month}-${String(end.getUTCDate()).padStart(2, '0')}`,
  };
}

/** The month before or after, without rolling into an invalid one. */
function shift(month: string, by: number): string {
  const [year, index] = month.split('-').map(Number);

  return monthOf(new Date(Date.UTC(year ?? 1970, (index ?? 1) - 1 + by, 1)));
}

export default async function UnitCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reference } = await params;
  const query = await searchParams;

  const [profile, property] = await Promise.all([
    requireVerifiedPartner(),
    getProperty(reference),
  ]);

  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  if (property === 'unauthenticated') {
    return (
      <Shell title={t.unitCalendar.title} partnerName={name} active="properties">
        <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
      </Shell>
    );
  }

  if (property === 'failed') notFound();

  const shell = (children: React.ReactNode) => (
    <Shell
      title={t.unitCalendar.title}
      partnerName={name}
      active="properties"
      badges={sidebarBadges(profile)}
    >
      <div className="grid gap-4">
        <Link
          href="/properties"
          className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg border border-line px-3 text-[12.5px] text-muted lg:min-h-0 lg:py-1.5"
        >
          <span aria-hidden="true">→</span>
          {t.unitCalendar.back}
        </Link>
        <h2 className="text-[15px] font-bold text-text">{property.name.ar}</h2>
        {children}
      </div>
    </Shell>
  );

  if (property.units.length === 0) {
    return shell(<p className="text-[12.5px] text-faint">{t.unitCalendar.noUnits}</p>);
  }

  /* The requested unit only if it is one of THIS property's; otherwise the first. */
  const requestedUnit = typeof query['unit'] === 'string' ? query['unit'] : '';
  const unit =
    property.units.find((candidate) => candidate.id === requestedUnit) ??
    property.units[0];

  const requestedMonth = typeof query['month'] === 'string' ? query['month'] : '';

  /*
    Falls back to the month the BUSINESS is in, not the one UTC is in. Damascus is UTC+3, so for the
    last three hours of every month this opened on the month that had just ended.
  */
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)
    ? requestedMonth
    : marketToday().slice(0, 7);

  const { from, to } = span(month);
  const calendar = unit ? await getUnitCalendar(unit.id, from, to) : 'failed';

  if (calendar === 'unauthenticated') {
    return shell(<p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>);
  }

  if (calendar === 'failed' || !unit) {
    return shell(<p className="text-sm text-muted">{t.unitCalendar.unreachable}</p>);
  }

  const days = calendar.days;

  const link = (unitId: string, target: string) =>
    `/properties/${reference}/calendar?unit=${encodeURIComponent(unitId)}&month=${target}`;

  return shell(
    <>
      {property.units.length > 1 ? (
        <nav aria-label={t.unitCalendar.unit} className="flex flex-wrap gap-1.5">
          {property.units.map((candidate) => (
            <Link
              key={candidate.id}
              href={link(candidate.id, month)}
              aria-current={candidate.id === unit.id ? 'true' : undefined}
              className={`inline-flex min-h-10 items-center rounded-lg border px-3 text-[11.5px] lg:min-h-0 lg:py-1.5 ${
                candidate.id === unit.id
                  ? 'border-gold bg-gold/15 text-gold-ink'
                  : 'border-line text-muted'
              }`}
            >
              {candidate.nameAr}
            </Link>
          ))}
        </nav>
      ) : null}

      <nav aria-label={t.unitCalendar.month} className="flex items-center gap-2">
        <Link
          href={link(unit.id, shift(month, -1))}
          aria-label={t.unitCalendar.previousMonth}
          className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-[12px] text-muted lg:min-h-0 lg:py-1.5"
        >
          <span aria-hidden="true">→</span>
        </Link>
        {/* The month is a Latin numeral pair inside an Arabic page, so it carries its own `dir`. */}
        <span className="text-[12.5px] font-bold text-text" dir="ltr">
          {month}
        </span>
        <Link
          href={link(unit.id, shift(month, 1))}
          aria-label={t.unitCalendar.nextMonth}
          className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-[12px] text-muted lg:min-h-0 lg:py-1.5"
        >
          <span aria-hidden="true">←</span>
        </Link>
      </nav>

      <UnitCalendar property={property} unitId={unit.id} month={month} days={days} />
    </>,
  );
}
