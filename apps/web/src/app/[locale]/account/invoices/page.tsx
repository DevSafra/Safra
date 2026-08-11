import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AccountShell } from '@/components/account-shell';
import { DateRange } from '@/components/date-range';
import { StatusPill } from '@/components/booking-status-pill';
import { getAccountSummary, getMyInvoices } from '@/lib/account';
import { ACCOUNT_METADATA, requireAccount } from '@/lib/account-page';
import { dynamicMessage } from '@/lib/dynamic-message';
import { formatMoney, localisedName } from '@/lib/localise';

/**
 * الفواتير — handoff §6.
 *
 * ## What this page CLAIMS to be
 *
 * A record of what each booking cost and what was paid, and it says so in a sentence at the top. It is
 * not a tax invoice: no gapless number from a register, no seller tax identity, no tax breakdown, and
 * nothing here is immutable after issue. The panel this replaced refused to render anything for exactly
 * that reason, and the reason was sound — so the honest resolution is to show the record and NAME what
 * it is not, rather than to keep showing nothing or to quietly promise a document we do not produce.
 *
 * ## Every figure comes from the API verbatim
 *
 * The total is `bookings.total_amount`, not a sum computed here. This page must never add the lines up
 * and print the result: a total re-derived on the client can disagree with the amount that was actually
 * charged, and the customer would be looking at two different numbers for the same booking.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = ACCOUNT_METADATA;

export default async function AccountInvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: requested } = await params;
  const { locale } = await requireAccount(requested, '/invoices');

  const summaryRead = await getAccountSummary();
  const summary =
    summaryRead === 'failed' || summaryRead === 'unauthenticated' ? null : summaryRead;

  const query = await searchParams;
  const cursor = typeof query['cursor'] === 'string' ? query['cursor'] : '';

  const t = await getTranslations('account');
  const invoices = await getMyInvoices(cursor || undefined);

  return (
    <AccountShell
      locale={locale}
      active="invoices"
      summary={summary}
      title={t('navInvoices')}
    >
      <p className="text-sm text-muted">{t('invoicesIntro')}</p>

      {invoices === 'failed' ? (
        <p className="mt-4 text-sm text-bad">{t('loadFailed')}</p>
      ) : invoices === 'unauthenticated' ? (
        <p className="mt-4 text-sm text-muted">{t('sessionExpired')}</p>
      ) : invoices.items.length === 0 ? (
        <p className="mt-4 rounded-lg border border-line bg-card p-6 text-center text-sm text-muted">
          {t('noInvoices')}
        </p>
      ) : (
        <>
          <ul className="mt-4 space-y-3">
            {invoices.items.map((invoice) => (
              <li key={invoice.reference}>
                <Link
                  href={`/${locale}/account/invoices/${encodeURIComponent(invoice.reference)}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-card p-4 transition-colors hover:border-gold/50"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-sm text-text">
                      {invoice.reference}
                    </span>
                    <span className="mt-1 block text-sm text-muted">
                      {localisedName(invoice.property, locale)}
                    </span>
                    <span className="mt-1 block text-xs text-faint">
                      <DateRange
                        from={invoice.checkIn}
                        to={invoice.checkOut}
                        locale={locale}
                      />
                    </span>
                  </span>

                  <span className="flex flex-col items-end gap-1">
                    <span className="font-semibold text-text">
                      {formatMoney(invoice.totalAmount, invoice.currencyCode, locale, {
                        exact: true,
                      })}
                    </span>
                    <StatusPill
                      status={invoice.bookingStatus}
                      label={dynamicMessage(
                        t,
                        `status.${invoice.bookingStatus}`,
                        invoice.bookingStatus,
                      )}
                    />
                    {/*
                      Paid or not, stated plainly. A receipt list where an unpaid booking looks exactly
                      like a settled one is the list somebody pays twice from.
                    */}
                    <span className="text-xs text-faint">
                      {invoice.paidAt
                        ? t('invoicePaidOn', { date: invoice.paidAt.slice(0, 10) })
                        : t('invoiceUnpaid')}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {/* A cursor moves FORWARD only, so the way back is offered explicitly — as in حجوزاتي. */}
          {cursor || invoices.nextCursor ? (
            <nav
              aria-label={t('navInvoices')}
              className="mt-6 flex flex-wrap items-center gap-2"
            >
              {cursor ? (
                <Link
                  href={`/${locale}/account/invoices`}
                  className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm text-muted lg:min-h-0 lg:py-2"
                >
                  {t('firstPage')}
                </Link>
              ) : null}

              {invoices.nextCursor ? (
                <Link
                  href={`/${locale}/account/invoices?cursor=${encodeURIComponent(invoices.nextCursor)}`}
                  className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm text-muted lg:min-h-0 lg:py-2"
                >
                  {t('loadMore')}
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}

      <p className="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-faint">
        {t('invoicesNotTax')}
      </p>
    </AccountShell>
  );
}
