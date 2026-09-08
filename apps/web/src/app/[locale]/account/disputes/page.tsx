import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { renderRedactions } from '@safra/i18n';

import { AccountShell } from '@/components/account-shell';
import { StatusPill } from '@/components/booking-status-pill';
import { DisputeForm } from '@/components/dispute-form';
import { getAccountSummary, getDisputableBookings, getMyDisputes } from '@/lib/account';
import { ACCOUNT_METADATA, requireAccount } from '@/lib/account-page';
import { ltrIsolate } from '@/lib/bidi';
import { localStatus } from '@/lib/status-word';

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
  /*
    `disputeReasons` is the FORM's wording — first-person questions a guest picks from — and it
    is deliberately not the canonical label. The label names the category on a list, in every
    app; the question asks it, here, once (Bashar, 2026-09-08).
  */
  const tReason = await getTranslations('disputeReasons');

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

      {/*
        ── the guest is told that the host reads their words ────────────────────

        Added 2026-09-08, with finding 223. Until that day nothing was disclosed here because there
        was nothing to disclose: the host was never shown the complaint. They are now — Bashar's
        model gives them the title and the description so they can answer, because SAFRA cannot
        adjudicate having heard one side.
    
        That makes this sentence part of the change rather than an addition to it. A guest writing
        an account of their night is entitled to know who will read it, and to know the boundary:
        their photographs, their contact details and their payment and wallet data are not shared,
        and a file of theirs crosses over only by an explicit staff decision. Told BEFORE the form
        rather than after the fact, which is the only order in which it is a disclosure.
      */}
      <p className="mt-2 rounded-card border border-line bg-field px-4 py-3 text-sm leading-relaxed text-text2">
        {t('disputesBothSides')}
      </p>

      <section className="mt-4 rounded-card border border-line bg-card p-5">
        <h2 className="font-display text-lg text-text">{t('disputesOpenTitle')}</h2>

        <div className="mt-3">
          {bookings.length === 0 ? (
            <p className="text-sm text-muted">{t('disputesNoBookings')}</p>
          ) : (
            <DisputeForm
              locale={locale}
              bookings={bookings}
              reasons={REASONS.map((value) => ({ value, label: tReason(value) }))}
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
                  {/*
                    `StatusPill`, not three hand-written branches.

                    They painted `resolved` green, `rejected` in `faint`, and everything else amber
                    — and two of those disagreed with the rest of the platform. `statusTone` gives
                    `open` CRIMSON, which read as amber here, and `rejected` **bad**, which read as
                    `faint`: the tone «One status, one word, one colour» reserves for a status
                    nobody has mapped. So a dispute decided in the host's favour was red on the
                    console and grey to the guest, whose complaint it was.

                    Bashar asked for exactly this to be legible (2026-09-08, decision 225): «If a
                    dispute is resolved in favour of the partner, the customer should clearly see
                    that outcome.» The WORD was already canonical — «محسوم لصالح الشريك» — and the
                    colour was saying «no signal» underneath it.

                    `navigation.spec.ts` holds the rule across the console's twenty sections and
                    cannot see this app, which is how three branches drifted here unnoticed.
                  */}
                  <StatusPill
                    status={dispute.status}
                    label={localStatus('disputeStatus', dispute.status, locale)}
                  />
                </div>

                {/* Redacted on the way in, so rendered for this reader on the way out. */}
                <p className="mt-1.5 text-sm font-semibold text-text">
                  {renderRedactions(dispute.title, locale)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {localStatus('disputeKind', dispute.kind, locale)}
                </p>

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
