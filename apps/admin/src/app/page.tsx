import Link from 'next/link';

import { getAttention, getPendingPartners, getPendingProperties } from '@/lib/api';
import { getStaffSession } from '@/lib/session-server';
import { SignOutButton } from '@/components/sign-out-button';

/**
 * The §9.2 dashboard: what needs a human today.
 *
 * Counters and the two verification queues, and nothing else. §9.3 lists eighteen
 * sections; building all of them at once produces eighteen mediocre screens, so this
 * is the operational spine — the things that block a partner being onboarded — and
 * the rest are recorded as deliberately deferred.
 */
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await getStaffSession();

  const [attention, partners, properties] = await Promise.all([
    getAttention(),
    getPendingPartners(),
    getPendingProperties(),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">Command Center</h1>
          <p className="mt-1 text-sm text-muted">
            {session?.user.email} · {session?.user.role.replace(/_/g, ' ')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/*
            Section links rather than a sidebar. Four destinations does not justify
            persistent chrome, and a queue-first console should open on the queues.
          */}
          <Link
            href="/staff"
            className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:border-gold/50 hover:text-gold"
          >
            Staff
          </Link>
          <Link
            href="/settings"
            className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:border-gold/50 hover:text-gold"
          >
            Rules Engine
          </Link>
          <Link
            href="/audit"
            className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:border-gold/50 hover:text-gold"
          >
            Audit log
          </Link>
          <SignOutButton />
        </div>
      </header>

      {/*
        Booking lookup by reference. §9.4's screen is reached by reference because
        that is what a customer reads out on the phone — there is no browsable list of
        every booking, and there should not be one.
      */}
      <form action="/bookings" method="get" className="mt-6 flex flex-wrap gap-2">
        <input
          name="reference"
          placeholder="BKG-2026-000123"
          aria-label="Find a booking by reference"
          className="min-w-56 flex-1 rounded-lg border border-line bg-field px-3 py-2 text-sm text-text"
        />
        <button
          type="submit"
          className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:border-gold/50 hover:text-gold"
        >
          Find booking
        </button>
      </form>

      {/* ── Attention counters (§9.2) ─────────────────────────────────────── */}
      <section className="mt-8 grid gap-3 sm:grid-cols-3">
        {attention === 'unauthenticated' || attention === 'failed' ? (
          <p className="text-sm text-bad sm:col-span-3">
            Could not load the counters. Refresh to try again.
          </p>
        ) : (
          <>
            <Counter
              label="Partners awaiting verification"
              value={attention.partners_pending_verification}
            />
            <Counter
              label="Listings awaiting review"
              value={attention.properties_pending_review}
            />
            {/*
              The SLA counter, not the raw awaiting-confirmation total. A partner has
              two hours; what needs a human right now is the set about to run out, and
              showing the larger number would bury it.
            */}
            <Counter
              label="Confirmations expiring within 30m"
              value={attention.bookings_sla_expiring_within_30m}
            />
          </>
        )}
      </section>

      {/* ── Partner queue (§8.1) ──────────────────────────────────────────── */}
      <Queue title="Partners awaiting verification" state={partners}>
        {(rows) =>
          rows.map((partner) => (
            <li key={partner.reference}>
              <Link
                href={`/partners/${partner.reference}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-card p-4 transition-colors hover:border-gold/50"
              >
                <span>
                  <span className="block text-sm text-text">{partner.legalName}</span>
                  <span className="block text-xs text-faint">
                    {partner.reference} · {partner.city.slug} · {partner.documents.length}{' '}
                    document
                    {partner.documents.length === 1 ? '' : 's'}
                  </span>
                </span>
                {/*
                  Screening state is surfaced in the QUEUE, not just on the detail
                  page. It is the one precondition a reviewer cannot satisfy by
                  reading documents, so seeing it before opening the row is what
                  stops a queue of unscreenable applications building up unnoticed.
                */}
                <span
                  className={
                    partner.sanctionsScreenedAt
                      ? 'rounded-full border border-good/40 bg-good/10 px-2.5 py-0.5 text-xs text-good'
                      : 'rounded-full border border-gold/40 bg-gold/10 px-2.5 py-0.5 text-xs text-gold'
                  }
                >
                  {partner.sanctionsScreenedAt ? 'Screened' : 'Not screened'}
                </span>
              </Link>
            </li>
          ))
        }
      </Queue>

      {/* ── Listing queue (§8.1, P-002) ───────────────────────────────────── */}
      <Queue title="Listings awaiting review" state={properties}>
        {(rows) =>
          rows.map((property) => (
            <li key={property.reference}>
              <Link
                href={`/properties/${property.reference}`}
                className="block rounded-lg border border-line bg-card p-4 transition-colors hover:border-gold/50"
              >
                <span className="block text-sm text-text">
                  {property.nameEn ?? property.nameAr}
                </span>
                <span className="block text-xs text-faint">
                  {property.reference} · submitted {property.createdAt.slice(0, 10)}
                </span>
              </Link>
            </li>
          ))
        }
      </Queue>
    </main>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <p className="text-3xl text-gold">{value}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
}

/**
 * A queue section that renders its own failure and empty states.
 *
 * Written once because both queues need the same three-way branch, and because an
 * empty queue and a failed load must never look alike — "nothing to do" and "we
 * could not tell you whether there is anything to do" lead to opposite actions.
 */
function Queue<T>({
  title,
  state,
  children,
}: {
  title: string;
  state: T[] | 'unauthenticated' | 'failed';
  children: (rows: T[]) => React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-lg text-text">{title}</h2>

      {state === 'failed' ? (
        <p className="mt-3 text-sm text-bad">Could not load this queue.</p>
      ) : state === 'unauthenticated' ? (
        <p className="mt-3 text-sm text-muted">Your session expired. Sign in again.</p>
      ) : state.length === 0 ? (
        <p className="mt-3 rounded-lg border border-line bg-card p-4 text-sm text-faint">
          Nothing waiting.
        </p>
      ) : (
        <ul className="mt-3 grid gap-2">{children(state)}</ul>
      )}
    </section>
  );
}
