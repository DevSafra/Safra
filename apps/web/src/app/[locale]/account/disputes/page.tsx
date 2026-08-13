import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AccountShell } from '@/components/account-shell';
import { DisputeForm } from '@/components/dispute-form';
import { getAccountSummary, getDisputableBookings, getMyDisputes } from '@/lib/account';
import { ACCOUNT_METADATA, requireAccount } from '@/lib/account-page';
import { ltrIsolate } from '@/lib/bidi';

/**
 * النزاعات — raising a dispute about a stay that went wrong.
 *
 * ## The gap this closes
 *
 * `disputes`, `dispute_evidence`, the console's queue and the payout freeze have existed since the
 * first migration, and nothing could create a row: staff opened disputes by hand from what a customer
 * said on the phone. So a customer's own account of what happened was a thing somebody else typed.
 *
 * ## The form is above the list, and the consequence is above the form
 *
 * Somebody arriving here has a problem, so making them scroll past their own history to report it
 * would be the wrong order — the same reasoning as الدعم. What is different is `intro`: opening a
 * dispute holds the host's payout for that booking until it is settled, and that is a serious thing to
 * do to another person. It is said before the form rather than after the button.
 *
 * ## No disputable booking means no form
 *
 * A dispute can only be raised about a booking that has been paid for. Rendering a form whose only
 * select is empty would let somebody fill in a complaint and be refused on submit; saying so instead
 * is the honest version of the same information.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = ACCOUNT_METADATA;

/** The four `dispute_kind` values, in the order a person is most likely to need them. */
const REASONS = [
  'property_unavailable',
  'not_as_described',
  'partner_no_response',
  'complaint',
] as const;

export default async function AccountDisputesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: requested } = await params;
  const { locale } = await requireAccount(requested, '/disputes');

  const summaryRead = await getAccountSummary();
  const summary =
    summaryRead === 'failed' || summaryRead === 'unauthenticated' ? null : summaryRead;

  const query = await searchParams;
  const cursor = typeof query['cursor'] === 'string' ? query['cursor'] : '';

  const t = await getTranslations('account');
  const tKind = await getTranslations('disputeKinds');
  const tStatus = await getTranslations('disputeStatuses');

  const [disputes, disputable] = await Promise.all([
    getMyDisputes(cursor || undefined),
    getDisputableBookings(),
  ]);

  const bookings =
    disputable === 'failed' || disputable === 'unauthenticated' ? [] : disputable.items;
  const disputePage =
    disputes === 'failed' || disputes === 'unauthenticated'
      ? { items: [], nextCursor: null }
      : disputes;
  const rows = disputePage.items;

  return (
    <AccountShell
      locale={locale}
      active="disputes"
      summary={summary}
      title={t('navDisputes')}
    >
      <p className="text-sm text-muted">{t('disputesIntro')}</p>

      <section className="mt-4 rounded-card border border-line bg-card p-5">
        <h2 className="font-display text-lg text-text">{t('disputesOpenTitle')}</h2>

        <div className="mt-3">
          {bookings.length === 0 ? (
            <p className="text-sm text-muted">{t('disputesNoBookings')}</p>
          ) : (
            <DisputeForm
              locale={locale}
              bookings={bookings}
              reasons={REASONS.map((value) => ({ value, label: tKind(value) }))}
              labels={{
                booking: t('disputesBooking'),
                reason: t('disputesReason'),
                subject: t('disputesSubject'),
                body: t('disputesBody'),
                bodyHint: t('disputesBodyHint'),
                submit: t('disputesSubmit'),
                submitting: t('disputesSubmitting'),
                failed: t('disputesFailed'),
              }}
            />
          )}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-display text-lg text-text">{t('disputesTitle')}</h2>

        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('disputesNone')}</p>
        ) : (
          <ul id="disputes-list" className="mt-3 grid gap-3">
            {rows.map((dispute) => (
              <li
                key={dispute.reference}
                className="rounded-card border border-line bg-card p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  {/*
                    `ltrIsolate`: `DSP-000112` is a Latin run in an Arabic sentence, and without
                    isolation the bidi algorithm moves the prefix to the wrong end of it.
                  */}
                  <span className="text-sm text-text">
                    {ltrIsolate(dispute.reference)}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      dispute.status === 'resolved'
                        ? 'border-ok/40 bg-ok/10 text-ok'
                        : dispute.status === 'rejected'
                          ? 'border-line bg-field text-faint'
                          : 'border-warn/40 bg-warn/10 text-warn'
                    }`}
                  >
                    {tStatus(dispute.status)}
                  </span>
                </div>

                <p className="mt-1.5 text-sm font-semibold text-text">{dispute.title}</p>
                <p className="mt-1 text-xs text-muted">{tKind(dispute.kind)}</p>

                <p className="mt-2 text-xs text-faint">
                  {t('disputesOpened')} {dispute.openedAt.slice(0, 10)} ·{' '}
                  {ltrIsolate(dispute.bookingReference)}
                </p>

                {/* The answer they were waiting for, once there is one. */}
                {dispute.resolution ? (
                  <div className="mt-3 rounded-lg border border-line bg-field p-3">
                    <p className="text-xs text-muted">{t('disputesResolution')}</p>
                    <p className="mt-1 text-sm whitespace-pre-wrap text-text">
                      {dispute.resolution}
                    </p>
                  </div>
                ) : null}

                {/* Said out loud: a masked number is silent, and they would wait for a call. */}
                {dispute.redactedCount > 0 ? (
                  <p className="mt-2 text-xs text-warn">
                    {t('disputesRedacted', { count: dispute.redactedCount })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {/*
          Paging, which this list never had.

          `getMyDisputes` asks for ten and returns a `nextCursor`, and the page threw it away — so a
          customer with an eleventh dispute had no way to reach it from anywhere in the app. The
          same control already exists on المفضلة and بطاقات الهدايا; النزاعات simply missed it.

          Found by a browser test that could not see a dispute it knew existed (2026-08-13).
        */}
        {cursor || disputePage.nextCursor ? (
          <nav
            aria-label={t('navDisputes')}
            className="mt-6 flex flex-wrap items-center gap-2"
          >
            {cursor ? (
              <Link
                href={`/${locale}/account/disputes`}
                className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm text-muted lg:min-h-0 lg:py-2"
              >
                {t('firstPage')}
              </Link>
            ) : null}
            {disputePage.nextCursor ? (
              <Link
                href={`/${locale}/account/disputes?cursor=${encodeURIComponent(disputePage.nextCursor)}`}
                className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm text-muted lg:min-h-0 lg:py-2"
              >
                {t('loadMore')}
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </AccountShell>
  );
}
