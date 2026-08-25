import Link from 'next/link';

import {
  getMyArrivals,
  searchArrivals,
  sidebarBadges,
  type PartnerArrival,
} from '@/lib/api';
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
 * ## The lookup, added for §6.5
 *
 * There was no search here, on the reasoning that today's list is a screenful and a filter over a
 * screenful is furniture. That reasoning covers FILTERING and misses what §6.5 actually asks for:
 * «إذا لم يكن لدى العميل إنترنت، يستطيع الشريك البحث برقم الحجز» — a guest at the counter with a
 * printed voucher, for a stay the day's list does not contain. The intro had been promising that
 * search for months while nothing implemented it.
 *
 * It searches by REFERENCE only. A name search over a partner's whole history is a different
 * screen with different privacy questions; the voucher carries the reference, so the reference is
 * what the case needs.
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

  /*
    Trimmed but not otherwise reshaped — no upper-casing, no stripping.

    A console screen that upper-cased a reference could not find any of the fixtures, because the
    format is not all-caps. Whatever the desk typed goes to the API, which bounds the SHAPE itself
    and answers anything else as a miss.
  */
  const typed = params['reference'];
  const reference = (Array.isArray(typed) ? (typed[0] ?? '') : (typed ?? '')).trim();

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

  /* A search REPLACES the day's list rather than sitting above it — one answer on the screen. */
  if (reference !== '') {
    /* §6.5 takes either: the API routes a reference-shaped term to the exact lookup itself. */
    const found = await searchArrivals(reference);

    if (found === 'unauthenticated') {
      return shell(<p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>);
    }

    return shell(
      <>
        <Lookup reference={reference} />

        {found === 'failed' ? (
          <p className="text-sm text-bad">{t.arrivals.lookup.failed}</p>
        ) : found.length === 0 ? (
          <p className="text-sm text-faint">{t.arrivals.lookup.notFound}</p>
        ) : (
          <>
            <h2 className="text-sm font-semibold text-text">
              {t.arrivals.lookup.result}
            </h2>
            <ul id="arrivals-list" className="grid gap-2.5">
              {found.map((arrival) => (
                <li key={arrival.reference}>
                  <Row arrival={arrival} />
                </li>
              ))}
            </ul>
          </>
        )}
      </>,
    );
  }

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

      <Lookup reference="" />

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

/**
 * §6.5's lookup — a plain GET form, so the result is a shareable, reload-safe URL.
 *
 * No `dir` on the input: the page is RTL and a reference is a Latin RUN inside it, which the bidi
 * algorithm lays out correctly on its own. `dir="ltr"` would move the field's START edge and put
 * the caret at the far side of its own label — the standing rule on fields somebody types into.
 */
function Lookup({ reference }: { reference: string }) {
  return (
    <form
      action="/arrivals"
      method="get"
      className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-card p-3"
    >
      <label className="grid min-w-0 flex-1 gap-1 text-[12px] text-muted">
        {t.arrivals.lookup.label}
        <input
          type="search"
          name="reference"
          defaultValue={reference}
          maxLength={32}
          className="min-h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-text lg:min-h-0 lg:py-2"
        />
      </label>

      <button
        type="submit"
        className="min-h-10 cursor-pointer rounded-lg border border-line px-4 text-sm text-text lg:min-h-0 lg:py-2"
      >
        {t.arrivals.lookup.submit}
      </button>

      {reference === '' ? null : (
        <Link
          href="/arrivals"
          className="inline-flex min-h-10 items-center px-2 text-[12.5px] text-muted lg:min-h-0"
        >
          {t.arrivals.lookup.clear}
        </Link>
      )}
    </form>
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
