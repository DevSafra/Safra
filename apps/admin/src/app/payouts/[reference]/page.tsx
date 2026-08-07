import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import { getPayout } from '@/lib/api';
import { Ltr, StatusPill } from '@/components/admin-table';
import { BackLink, type BackTarget } from '@/components/back-link';
import { PayoutActions } from '@/components/payout-actions';
import { amount, shortDateTime } from '@/lib/format';
import { backTarget } from '@/lib/search-params';
import { statusTone } from '@/lib/status-tone';
import { auditAction, label, t } from '@/lib/strings';

/**
 * One partner transfer, and everything needed to answer for it (§9.3).
 *
 * ## Four sections, and why they are on one page
 *
 * "Why was this partner sent this amount" is answered by the covered BOOKINGS; "who decided" by
 * the AUDIT trail; "does it agree with the books" by the LEDGER movement. Splitting them across
 * screens means the question gets asked and not answered, because the person asking would have to
 * know to look in three places.
 *
 * ## The reconciliation failure this screen is built to surface
 *
 * A `paid` payout carries an `entry_group_id` by CHECK constraint, and the ledger section reads
 * the movement through it. A paid payout showing no movement should therefore be impossible — so
 * if it ever appears, the screen says so loudly rather than rendering an empty list that looks
 * like a slow query. That is the whole value of showing the two side by side.
 */
export const dynamic = 'force-dynamic';

export default async function PayoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  /* The list position to return to — the standing "opening a row and coming back" rule. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reference } = await params;
  const back = backTarget('/payouts', await searchParams, reference);
  const payout = await getPayout(reference);

  if (payout === 'unauthenticated') {
    return (
      <Shell back={back}>
        <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
      </Shell>
    );
  }

  if (payout === 'failed') notFound();

  /* Paid, with nothing behind it. A constraint makes this impossible; if it happens, say so. */
  const unreconciled = payout.status === 'paid' && payout.ledger.length === 0;

  return (
    <Shell back={back}>
      <header>
        <p className="text-xs text-faint">
          <Ltr>{payout.reference}</Ltr>
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-text">
          {payout.partnerName ?? t.admin.noData}
        </h1>
        <p className="mt-3">
          <StatusPill tone={statusTone(payout.status)}>
            {label(t.enums.payoutStatus, payout.status)}
          </StatusPill>
        </p>
      </header>

      <Section title={t.sections.payouts.summary}>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Row
            label={t.sections.payouts.gross}
            value={<Ltr>{amount(payout.grossAmount, payout.currencyCode)}</Ltr>}
          />
          <Row
            label={t.sections.payouts.fine}
            value={<Ltr>{amount(payout.fineAmount, payout.currencyCode)}</Ltr>}
          />
          <Row
            label={t.sections.payouts.net}
            value={
              <Ltr className="font-extrabold text-gold">
                {amount(payout.netAmount, payout.currencyCode)}
              </Ltr>
            }
          />
          <Row
            label={t.sections.payouts.period}
            value={
              <Ltr>
                {payout.periodStart} → {payout.periodEnd}
              </Ltr>
            }
          />
          {payout.scheduledFor ? (
            <Row
              label={t.sections.payouts.scheduledFor}
              value={<Ltr>{payout.scheduledFor}</Ltr>}
            />
          ) : null}
          {payout.releasedAt ? (
            <Row
              label={t.sections.payouts.releasedAt}
              value={<Ltr>{shortDateTime(payout.releasedAt)}</Ltr>}
            />
          ) : null}
          {payout.paidAt ? (
            <Row
              label={t.sections.payouts.paidAt}
              value={<Ltr>{shortDateTime(payout.paidAt)}</Ltr>}
            />
          ) : null}
          {payout.paidReference ? (
            <Row
              label={t.sections.payouts.paidReference}
              value={<Ltr>{payout.paidReference}</Ltr>}
            />
          ) : null}
          {payout.holdReason ? (
            <Row label={t.sections.payouts.holdReason} value={payout.holdReason} />
          ) : null}
        </dl>
      </Section>

      {/* ── What the amount is made of ─────────────────────────────────────── */}
      <Section
        title={`${t.sections.payouts.coveredBookings} (${payout.bookings.length})`}
      >
        {payout.bookings.length === 0 ? (
          <p className="text-sm text-faint">{t.sections.payouts.noBookings}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-start text-[11.5px] text-faint">
                  <Th>{t.sections.payouts.colBooking}</Th>
                  <Th>{t.sections.payouts.colProperty}</Th>
                  <Th>{t.sections.payouts.colStay}</Th>
                  <Th>{t.sections.payouts.colAmount}</Th>
                </tr>
              </thead>
              <tbody>
                {payout.bookings.map((booking) => (
                  <tr key={booking.bookingReference} className="border-t border-line">
                    <Td>
                      <Ltr className="text-sky">{booking.bookingReference}</Ltr>
                    </Td>
                    <Td>{booking.property ?? t.admin.noData}</Td>
                    <Td>
                      <Ltr className="text-[11.5px] text-faint">
                        {booking.checkIn} → {booking.checkOut}
                      </Ltr>
                    </Td>
                    <Td>
                      <Ltr className="font-semibold">
                        {amount(booking.amount, payout.currencyCode)}
                      </Ltr>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Who decided, and when ──────────────────────────────────────────── */}
      <Section title={t.sections.payouts.trail}>
        {payout.trail.length === 0 ? (
          <p className="text-sm text-faint">{t.sections.payouts.noTrail}</p>
        ) : (
          <ol className="grid gap-2 text-sm">
            {payout.trail.map((entry) => (
              <li
                key={`${entry.action}-${entry.createdAt}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-card px-4 py-2.5"
              >
                <span className="font-semibold text-text">
                  {auditAction(entry.action)}
                </span>
                <Ltr className="text-[11.5px] text-faint">
                  {entry.actorEmail ?? t.admin.noData}
                </Ltr>
                <Ltr className="ms-auto text-[11.5px] text-faint">
                  {shortDateTime(entry.createdAt)}
                </Ltr>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* ── Does it agree with the books ───────────────────────────────────── */}
      <Section title={t.sections.payouts.ledger}>
        {unreconciled ? (
          <p
            role="alert"
            className="mb-3 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
          >
            {t.sections.payouts.ledgerMissing}
          </p>
        ) : null}

        {payout.ledger.length === 0 ? (
          <p className="text-sm text-faint">{t.sections.payouts.noLedger}</p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {payout.ledger.map((entry) => (
              <li
                key={`${entry.account}-${entry.direction}`}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-card px-4 py-2.5"
              >
                <span
                  className={`text-[11.5px] font-bold ${
                    entry.direction === 'debit' ? 'text-sky' : 'text-ok'
                  }`}
                >
                  {entry.direction === 'debit'
                    ? t.sections.payouts.debit
                    : t.sections.payouts.credit}
                </span>
                <Ltr className="text-muted">{entry.account}</Ltr>
                <Ltr className="ms-auto font-semibold">
                  {amount(entry.amount, payout.currencyCode)}
                </Ltr>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── The decisions still available ──────────────────────────────────── */}
      <Section title={t.sections.payouts.actions}>
        <PayoutActions id={payout.id} status={payout.status} />
      </Section>
    </Shell>
  );
}

function Shell({ back, children }: { back: BackTarget; children: ReactNode }) {
  return (
    <main className="mx-auto grid max-w-4xl gap-6 px-4 py-8">
      <BackLink target={back} section={t.sections.payouts.title} />
      {children}
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-gold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label: name, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 rounded-lg border border-line bg-card px-4 py-2.5">
      <dt className="text-[12.5px] text-faint">{name}</dt>
      <dd className="text-text">{value}</dd>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="pb-2 text-start font-normal">{children}</th>;
}

function Td({ children }: { children: ReactNode }) {
  return <td className="py-2.5 text-start align-top">{children}</td>;
}
