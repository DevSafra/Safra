import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AccountShell } from '@/components/account-shell';
import { SupportForm } from '@/components/support-forms';
import { getAccountSummary, getMySupportTickets } from '@/lib/account';
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
  const { locale: requested } = await params;
  const { locale } = await requireAccount(requested, '/support');

  const summaryRead = await getAccountSummary();
  const summary =
    summaryRead === 'failed' || summaryRead === 'unauthenticated' ? null : summaryRead;

  const query = await searchParams;
  const cursor = typeof query['cursor'] === 'string' ? query['cursor'] : '';

  const t = await getTranslations('account');
  const tickets = await getMySupportTickets(cursor || undefined);

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
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${
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

            {/* A cursor moves forward only, so the way back is offered explicitly. */}
            {cursor || tickets.nextCursor ? (
              <nav
                aria-label={t('supportMineTitle')}
                className="mt-4 flex flex-wrap items-center gap-2"
              >
                {cursor ? (
                  <Link
                    href={`/${locale}/account/support`}
                    className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm text-muted lg:min-h-0 lg:py-2"
                  >
                    {t('firstPage')}
                  </Link>
                ) : null}

                {tickets.nextCursor ? (
                  <Link
                    href={`/${locale}/account/support?cursor=${encodeURIComponent(tickets.nextCursor)}`}
                    className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm text-muted lg:min-h-0 lg:py-2"
                  >
                    {t('loadMore')}
                  </Link>
                ) : null}
              </nav>
            ) : null}
          </>
        )}
      </section>
    </AccountShell>
  );
}
