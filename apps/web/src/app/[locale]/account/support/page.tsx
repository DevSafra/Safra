import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { readShown, shownCount } from '@safra/contracts';

import { AccountShell } from '@/components/account-shell';
import { ListMore } from '@/components/list-more';
import { NewMarker } from '@/components/new-marker';
import { SupportForm } from '@/components/support-forms';
import { getAccountSummary, getMySupportTickets } from '@/lib/account';
import { getGroupTrip } from '@/lib/group-trips';
import { localisedText } from '@/lib/localise';
import { ACCOUNT_METADATA, requireAccount } from '@/lib/account-page';
import { ltrIsolate } from '@/lib/bidi';

/**
 * الدعم — asking SAFRA for help (Bashar, 2026-08-12).
 *
 * A ticket is a CONVERSATION with no other subject, so it lands in the console's existing three-party
 * inbox rather than in a second place staff have to remember to check. See `packages/contracts/src/support.ts`.
 *
 * The open form sits above the list: somebody arriving here has a problem, and making them scroll past
 * their own history to report it would be the wrong order.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = ACCOUNT_METADATA;

export default async function AccountSupportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;

  /**
   * «استفسر عن هذه الرحلة» — which trip the reader came from (Bashar, 2026-09-29).
   *
   * Two guards, and they do different jobs:
   *
   * 1. The SHAPE is checked before the value goes anywhere near the sign-in redirect, because
   *    `requireSignedIn` interpolates its argument into `?next=` and its own docblock says a path
   *    taken from a request is how that becomes an open redirect. A slug that cannot express a
   *    scheme, a host or a slash cannot express one there either.
   * 2. The value is then RESOLVED against a published trip, and every word of the prefill comes
   *    from that row. Nothing the reader typed reaches the textarea — the query chooses WHICH
   *    known trip and nothing else, which is the rule `returnHref` states for the console's back
   *    control. An unknown slug prefills nothing and says nothing about why.
   */
  const asked = typeof query['trip'] === 'string' ? query['trip'] : '';
  const tripSlug =
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(asked) && asked.length <= 80 ? asked : '';

  const { locale: requested } = await params;
  /* The slug travels through sign-in, so arriving signed-out does not lose the trip. */
  const { locale } = await requireAccount(
    requested,
    tripSlug ? `/support?trip=${encodeURIComponent(tripSlug)}` : '/support',
  );

  const summaryRead = await getAccountSummary();
  const summary =
    summaryRead === 'failed' || summaryRead === 'unauthenticated' ? null : summaryRead;

  const cursor = typeof query['cursor'] === 'string' ? query['cursor'] : '';

  /* How much of the list to show: «عرض المزيد» adds fifteen (see @safra/contracts/show-more). */

  const shown = shownCount(query['shown']);

  const t = await getTranslations('account');
  const tg = await getTranslations('groups');
  const tickets = await readShown(
    (limit, after) => getMySupportTickets(after, limit),
    shown,
    cursor || undefined,
  );

  /*
    `getGroupTrip` answers only for a PUBLISHED trip, so a draft's slug prefills nothing — the same
    answer a slug nobody ever used gets, which is what keeps an unannounced trip unannounced.
  */
  const trip = tripSlug ? await getGroupTrip(tripSlug) : null;
  const prefill = trip
    ? tg('enquiryPrefill', {
        title: localisedText(trip.title, locale),
        reference: trip.slug,
      })
    : '';

  return (
    <AccountShell
      locale={locale}
      active="support"
      summary={summary}
      title={t('navSupport')}
    >
      <p className="text-sm text-muted">{t('supportIntro')}</p>

      <section className="mt-4 rounded-card border border-line bg-card p-5">
        <h2 className="font-display text-lg text-text">{t('supportOpenTitle')}</h2>
        <div className="mt-3">
          <SupportForm
            locale={locale}
            initialBody={prefill}
            labels={{
              field: t('supportBodyLabel'),
              hint: t('supportBodyHint'),
              submit: t('supportSubmit'),
              submitting: t('supportSubmitting'),
              failed: t('supportFailed'),
            }}
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-lg text-text">{t('supportMineTitle')}</h2>

        {tickets === 'failed' ? (
          <p className="mt-3 text-sm text-bad">{t('loadFailed')}</p>
        ) : tickets === 'unauthenticated' ? (
          <p className="mt-3 text-sm text-muted">{t('sessionExpired')}</p>
        ) : tickets.items.length === 0 ? (
          <p className="mt-3 rounded-lg border border-line bg-card p-6 text-center text-sm text-muted">
            {t('supportNone')}
          </p>
        ) : (
          <>
            <ul className="mt-3 space-y-3">
              {tickets.items.map((ticket) => (
                <li key={ticket.reference}>
                  <Link
                    href={`/${locale}/account/support/${encodeURIComponent(ticket.reference)}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-card p-4 transition-colors hover:border-gold/50"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-sm text-text">
                        {ltrIsolate(ticket.reference)}
                      </span>
                      {/* The last visible message, so the row says what the thread is about. */}
                      {ticket.lastMessage ? (
                        <span className="mt-1 block truncate text-sm text-muted">
                          {ticket.lastMessage}
                        </span>
                      ) : null}
                      <span className="mt-1 block text-xs text-faint">
                        {t('supportMessages', { count: ticket.messageCount })}
                      </span>
                    </span>

                    <span className="flex flex-col items-end gap-1">
                      {ticket.unread ? <NewMarker label={t('supportUnread')} /> : null}
                      <span
                        className={`rounded-full border px-2 py-0.5 text-13 ${
                          ticket.closed
                            ? 'border-line bg-field text-faint'
                            : 'border-ok/40 bg-ok/10 text-ok'
                        }`}
                      >
                        {ticket.closed ? t('supportClosedLabel') : t('supportOpenLabel')}
                      </span>
                      <span className="text-xs text-faint" dir="ltr">
                        {(ticket.lastMessageAt ?? ticket.openedAt).slice(0, 10)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            <ListMore
              path={`/${locale}/account/support`}
              cursor={cursor || undefined}
              shown={shown}
              nextCursor={tickets.nextCursor}
              labels={{
                more: t('loadMore'),
                loading: t('loadingMore'),
                first: t('firstPage'),
              }}
            />
          </>
        )}
      </section>
    </AccountShell>
  );
}
