import Link from 'next/link';

import { getMyArrivals, sidebarBadges, type PartnerArrival } from '@/lib/api';
import { requireVerifiedPartner, sectionAccess } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { SectionRefusal } from '@/components/section-refusal';
import { ArrivalActions } from '@/components/arrival-actions';
import { Ltr } from '@/components/ltr';
import { count } from '@/lib/format';
import { fill, t } from '@/lib/strings';

/**
 * الوصول اليوم — the desk screen (Bashar, 2026-08-23).
 *
 * ## The screen the employees feature was described from
 *
 * «reseption employees working for booking for clients». A guest is at the counter; the person
 * serving them finds the booking and admits it. Everything not in service of that is off the page.
 *
 * ## What is deliberately absent
 *
 * **No money.** `booking.check_in` does not carry `payout.read_own`, and a nightly rate on this
 * list would hand the business's earnings to whoever works the desk — the same reasoning that
 * withheld the dashboard's takings. The endpoint does not send it, so it cannot leak through a
 * forgotten field.
 *
 * **No search box yet.** The list is today's arrivals and the ones overdue, which at any real
 * property is a screenful; a filter over a screenful is furniture. It becomes necessary when a
 * partner is large enough to page, and the pager is already here for that day.
 *
 * ## «اليوم» carries yesterday too, on purpose
 *
 * A guest arriving at 01:00 for a booking dated yesterday is exactly who is standing at the desk,
 * and a strict same-date filter loses them at the moment they are hardest to help. Those rows are
 * marked «موعده سابق» rather than hidden — the reader should see that the date has passed, because
 * it is usually the reason something needs checking.
 */
export const dynamic = 'force-dynamic';

export default async function ArrivalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params['cursor'];
  const cursor = Array.isArray(raw) ? raw[0] : raw;

  /* Guarded before the fetch, so the refusal is never a 403 reported as a dead session. */
  const [access, profile] = await Promise.all([
    sectionAccess('arrivals'),
    requireVerifiedPartner(),
  ]);

  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  const shell = (children: React.ReactNode) => (
    <Shell
      title={t.arrivals.title}
      partnerName={name}
      active="arrivals"
      badges={sidebarBadges(profile)}
    >
      <div className="grid gap-4">{children}</div>
    </Shell>
  );

  if (access !== 'open') return shell(<SectionRefusal access={access} />);

  const page = await getMyArrivals(cursor);

  if (page === 'unauthenticated') {
    return shell(<p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>);
  }

  if (page === 'failed') {
    return shell(<p className="text-sm text-bad">{t.arrivals.loadFailed}</p>);
  }

  return shell(
    <>
      <p className="text-[12.5px] leading-relaxed text-muted">{t.arrivals.intro}</p>

      {page.items.length === 0 ? (
        <p className="text-sm text-faint">{t.arrivals.empty}</p>
      ) : (
        <ul id="arrivals-list" className="grid gap-2.5">
          {page.items.map((arrival) => (
            <li key={arrival.reference}>
              <Row arrival={arrival} />
            </li>
          ))}
        </ul>
      )}

      {page.nextCursor ? (
        <Link
          href={`/arrivals?cursor=${encodeURIComponent(page.nextCursor)}`}
          className="inline-flex min-h-10 w-fit items-center rounded-lg border border-line px-4 text-sm text-muted lg:min-h-0 lg:py-2"
        >
          {t.arrivals.loadMore}
        </Link>
      ) : null}
    </>,
  );
}

/** One booking: who, where, how long — and the one button that matters. */
function Row({ arrival }: { arrival: PartnerArrival }) {
  /*
    Compared as YYYY-MM-DD strings, which sort lexicographically and carry no timezone of their own.
    The API already decided what "today" means in the CITY's zone; re-deriving it here from the
    browser's or the server's clock would give a second answer, and the two would disagree for
    exactly the readers this screen exists for — the ones working near midnight.
  */
  const overdue =
    arrival.status !== 'checked_in' &&
    arrival.checkIn < new Date().toISOString().slice(0, 10);

  return (
    <div className="grid gap-3 rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-0.5">
          <p className="text-sm font-semibold text-text">{arrival.guestName}</p>
          <p className="text-[12.5px] text-muted">
            {arrival.propertyName} · {arrival.unitName}
          </p>
          {/* The reference is a Latin run on an Arabic line — isolated as a VALUE, never a label. */}
          <Ltr className="text-[12px] text-faint">{arrival.reference}</Ltr>
        </div>

        <div className="grid justify-items-end gap-0.5 text-[12px] text-muted">
          <Ltr>{arrival.checkIn}</Ltr>
          <span>
            {fill(t.arrivals.nights, { n: count(arrival.nights) })} ·{' '}
            {fill(t.arrivals.guests, { n: count(arrival.guests) })}
          </span>
          {overdue ? <span className="text-warn">{t.arrivals.overdue}</span> : null}
        </div>
      </div>

      <ArrivalActions arrival={arrival} />
    </div>
  );
}
