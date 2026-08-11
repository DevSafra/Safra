import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { AccountShell } from '@/components/account-shell';
import { BackLink } from '@/components/back-link';
import { DateRange } from '@/components/date-range';
import { PrintButton } from '@/components/print-button';
import { StatusPill } from '@/components/booking-status-pill';
import { getAccountSummary, getInvoice, type InvoiceLineRow } from '@/lib/account';
import { ACCOUNT_METADATA, requireAccount } from '@/lib/account-page';
import { dynamicMessage } from '@/lib/dynamic-message';
import { ltrIsolate } from '@/lib/bidi';
import { formatMoney, localisedName } from '@/lib/localise';
import { returnParam } from '@/lib/return-to';
import type { Locale } from '@/i18n/routing';

/**
 * One receipt in full — handoff §6, الفواتير.
 *
 * ## The lines are NOT added up here
 *
 * The total printed at the foot is `bookings.total_amount`, the figure that was actually charged. This
 * page deliberately does not sum `lines` and show the result: if a booking was priced under an older
 * fee rule, a re-derived total would disagree with the charge, and the customer would be reading two
 * different numbers for one payment. The lines EXPLAIN the total; they do not constitute it.
 *
 * ## A reference that is not yours is a 404
 *
 * The API answers 404 for somebody else's receipt indistinguishably from one that does not exist, and
 * this page renders `notFound()` for both. References are short and sequential, so any difference
 * between the two answers is a way to enumerate them.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = ACCOUNT_METADATA;

/** A row in the breakdown. Deductions carry the sign; the amount stays exactly as stored. */
function Line({
  line,
  currency,
  locale,
  label,
}: {
  readonly line: InvoiceLineRow;
  readonly currency: string;
  readonly locale: Locale;
  readonly label: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm text-text" dir="ltr">
        {/*
          The minus is rendered here rather than baked into the figure, so the amount stays identical
          to the stored value and `formatMoney` keeps formatting a positive number.
        */}
        {line.deduction ? '−' : ''}
        {formatMoney(line.amount, currency, locale, { exact: true })}
      </dd>
    </div>
  );
}

export default async function AccountInvoicePage({
  params,
}: {
  params: Promise<{ locale: string; reference: string }>;
}) {
  const { locale: requested, reference } = await params;
  const { locale } = await requireAccount(
    requested,
    `/invoices/${encodeURIComponent(reference)}`,
  );

  const summaryRead = await getAccountSummary();
  const summary =
    summaryRead === 'failed' || summaryRead === 'unauthenticated' ? null : summaryRead;

  const t = await getTranslations('account');
  /* A second catalogue: payment methods are shared with the checkout, not owned by this screen. */
  const tm = await getTranslations('paymentMethods');
  const invoice = await getInvoice(reference);

  if (invoice === 'unauthenticated') {
    return (
      <AccountShell
        locale={locale}
        active="invoices"
        summary={summary}
        title={t('navInvoices')}
      >
        <p className="text-sm text-muted">{t('sessionExpired')}</p>
      </AccountShell>
    );
  }

  /* 'failed' covers both a real fetch failure and a 404 — see the note above on why they agree. */
  if (invoice === 'failed') notFound();

  return (
    <AccountShell
      locale={locale}
      active="invoices"
      summary={summary}
      title={t('navInvoices')}
    >
      <div className="grid gap-6">
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <BackLink href={`/${locale}/account/invoices`} locale={locale} />
          <PrintButton label={t('invoiceDownload')} />
          <span className="text-xs text-faint">{t('invoicePrintNote')}</span>
        </div>

        {/* ── The stay this receipt is for ── */}
        <section className="rounded-card border border-line bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-faint">{t('invoiceReferenceLabel')}</p>
              <p className="font-mono text-sm text-text">{invoice.reference}</p>
            </div>
            <StatusPill
              status={invoice.bookingStatus}
              label={dynamicMessage(
                t,
                `status.${invoice.bookingStatus}`,
                invoice.bookingStatus,
              )}
            />
          </div>

          <h2 className="mt-4 font-display text-lg text-text">
            {localisedName(invoice.property, locale)}
          </h2>
          <p className="mt-1 text-sm text-muted">{localisedName(invoice.city, locale)}</p>

          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-faint">{t('invoiceStayHeading')}</dt>
              <dd className="mt-1 text-sm text-text">
                <DateRange from={invoice.checkIn} to={invoice.checkOut} locale={locale} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-faint">{t('invoiceNightsLabel')}</dt>
              <dd className="mt-1 text-sm text-text">{invoice.nights}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">{t('invoiceIssuedLabel')}</dt>
              <dd className="mt-1 text-sm text-text" dir="ltr">
                {invoice.issuedAt.slice(0, 10)}
              </dd>
            </div>
          </dl>

          <Link
            href={`/${locale}/booking/${encodeURIComponent(invoice.reference)}?${returnParam('invoices')}`}
            className="mt-4 inline-flex min-h-10 w-fit items-center text-sm text-gold hover:underline print:hidden lg:min-h-0"
          >
            {t('invoiceBookingLink')}
          </Link>
        </section>

        {/* ── The breakdown ── */}
        <section className="rounded-card border border-line bg-card p-5">
          <h2 className="font-display text-lg text-text">
            {t('invoiceBreakdownHeading')}
          </h2>

          <dl className="mt-2 divide-y divide-line">
            {invoice.lines.map((line) => (
              <Line
                key={line.key}
                line={line}
                currency={invoice.currencyCode}
                locale={locale}
                label={t(`invoiceLines.${line.key}`)}
              />
            ))}
          </dl>

          <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-line pt-3">
            <span className="font-semibold text-text">{t('invoiceTotalLabel')}</span>
            <span className="font-display text-xl text-gold" dir="ltr">
              {formatMoney(invoice.totalAmount, invoice.currencyCode, locale, {
                exact: true,
              })}
            </span>
          </div>

          <p className="mt-2 text-xs text-faint">
            {invoice.paidAt
              ? t('invoicePaidOn', { date: ltrIsolate(invoice.paidAt.slice(0, 10)) })
              : t('invoiceUnpaid')}
          </p>
        </section>

        {/* ── Every payment attempt, failures included ── */}
        <section className="rounded-card border border-line bg-card p-5">
          <h2 className="font-display text-lg text-text">
            {t('invoicePaymentsHeading')}
          </h2>

          {invoice.payments.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{t('invoiceNoPayments')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {invoice.payments.map((payment) => (
                <li
                  key={payment.reference}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-xs text-faint">
                      {payment.reference}
                    </span>
                    <span className="mt-1 block text-sm text-text">
                      {dynamicMessage(tm, payment.method, payment.method)}
                    </span>
                    <span className="mt-1 block text-xs text-muted">
                      {dynamicMessage(
                        t,
                        `paymentStatus.${payment.status}`,
                        payment.status,
                      )}
                    </span>
                  </span>

                  <span className="flex flex-col items-end gap-1">
                    <span className="text-sm text-text" dir="ltr">
                      {formatMoney(payment.amount, payment.currencyCode, locale, {
                        exact: true,
                      })}
                    </span>
                    <span className="text-xs text-faint">
                      {payment.capturedAt ? payment.capturedAt.slice(0, 10) : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-xs leading-relaxed text-faint">{t('invoicesNotTax')}</p>
      </div>
    </AccountShell>
  );
}
