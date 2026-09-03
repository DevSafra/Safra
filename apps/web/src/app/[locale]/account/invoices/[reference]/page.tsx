import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { AccountShell } from '@/components/account-shell';
import { BackLink } from '@/components/back-link';
import { DateRange } from '@/components/date-range';
import { StatusPill, customerBookingStatus } from '@/components/booking-status-pill';
import { getAccountSummary, getInvoice, type InvoiceLineRow } from '@/lib/account';
import { ACCOUNT_METADATA, requireAccount } from '@/lib/account-page';
import { dynamicMessage } from '@/lib/dynamic-message';
import { ltrIsolate } from '@/lib/bidi';
import { addMoney, formatMoney, localisedName } from '@/lib/localise';
import { returnParam, returnTo } from '@/lib/return-to';
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
  searchParams,
}: {
  params: Promise<{ locale: string; reference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: requested, reference } = await params;
  /* Where the reader came from, so «رجوع» goes back there rather than to this section's list. */
  const query = await searchParams;
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
        title={t('invoiceTitle')}
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
      title={t('invoiceTitle')}
    >
      <div className="grid gap-6">
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <BackLink
            href={returnTo(locale, query['from'], 'invoices', query['ref'])}
            locale={locale}
          />
          {/*
            A LINK, not a button (Bashar, 2026-08-18: download it, do not open the print dialog).

            There is a URL now — the route beside this page renders the receipt to a PDF and sends it
            as an attachment — so an anchor is the honest element, and the whole control works with no
            client JavaScript at all. `download` names the file after the reference; the header does
            the forcing, so a browser that ignores the attribute still downloads rather than navigates.
          */}
          <a
            href={`/${locale}/account/invoices/${encodeURIComponent(invoice.reference)}/pdf`}
            download={`${invoice.reference}.pdf`}
            className="inline-flex min-h-10 w-fit cursor-pointer items-center gap-2 rounded-lg border border-gold px-4 text-sm text-gold transition-colors hover:btn-gold hover: print:hidden lg:min-h-0 lg:py-2"
          >
            <span aria-hidden="true">⤓</span>
            {t('invoiceDownload')}
          </a>
        </div>

        {/* ── The stay this receipt is for ── */}
        <section className="rounded-card border border-line bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-faint">{t('invoiceReferenceLabel')}</p>
              <p className="font-mono text-sm text-text">{invoice.reference}</p>
            </div>
            <StatusPill
              status={customerBookingStatus(invoice.bookingStatus)}
              label={dynamicMessage(
                t,
                `status.${customerBookingStatus(invoice.bookingStatus)}`,
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
              {/*
                ISOLATED, not `dir="ltr"` (Bashar, 2026-08-18).

                `dir` on a BLOCK element also moves its start edge, so the date left-aligned inside
                a full-width grid cell while «تاريخ الحجز» stayed on the right — the label and its
                value at opposite ends of the row, which reads as two unrelated things. U+2066…U+2069
                fix the ORDER of the digits and leave the alignment to the document, which is the
                same call `profile` and `wallet` already make.
              */}
              <dd className="mt-1 text-sm text-text">
                {ltrIsolate(invoice.issuedAt.slice(0, 10))}
              </dd>
            </div>
          </dl>

          <Link
            href={`/${locale}/account/bookings/${encodeURIComponent(invoice.reference)}?${returnParam('invoice', invoice.reference)}`}
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
            {customerLines(invoice.lines, invoice.currencyCode).map((line) => (
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

        {/*
          On screen, not on the document (Bashar, 2026-08-18).

          It is the only line distinguishing a payment record from a tax invoice, so it stays where
          the customer reads their receipts — `print:hidden` takes it out of the PDF and nothing
          else. Deleting the key would take it off the list screen too, which was not the ask.
        */}
        <p className="text-xs leading-relaxed text-faint print:hidden">
          {t('invoicesNotTax')}
        </p>
      </div>
    </AccountShell>
  );
}

/**
 * The lines as the CUSTOMER sees them: the service fee folded into the accommodation.
 *
 * Bashar, 2026-09-03, three times and finally «the total/final price should only be displayed to
 * the customer/guest» — SAFRA's fee is between the platform and the partner as far as a guest is
 * concerned, and it is not to be named on their screens.
 *
 * **Folded, not dropped.** An invoice is a document somebody may hand to an employer or an
 * accountant, and its lines have to reach its total. Removing a charged line would leave a
 * breakdown that is short by the fee with nothing accounting for the gap — which states the fee to
 * anyone who subtracts, and states it as an error. Adding it into the accommodation line keeps the
 * arithmetic exact and the fee unnamed, and it leaves the discount, gift-card and wallet lines
 * alone, which a customer does need to see.
 *
 * Nothing about the booking, the ledger or the partner's payable changes; those keep the fee
 * itemised, which is where it belongs. This is a rendering of an unchanged record.
 */
function customerLines(
  lines: readonly InvoiceLineRow[],
  currency: string,
): InvoiceLineRow[] {
  const fee = lines.find((line) => line.key === 'serviceFee');

  if (!fee) return [...lines];

  return lines
    .filter((line) => line.key !== 'serviceFee')
    .map((line) =>
      line.key === 'accommodation'
        ? { ...line, amount: addMoney(line.amount, fee.amount, currency) }
        : line,
    );
}
