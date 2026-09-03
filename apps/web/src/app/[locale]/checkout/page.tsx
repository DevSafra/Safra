import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CheckoutForm } from '@/components/checkout-form';
import { CouponProvider } from '@/components/coupon-context';
import { CouponField } from '@/components/coupon-field';
import { CheckoutTotal } from '@/components/checkout-total';
import { couponMessages } from '@/lib/coupon-messages';
import { DateRange } from '@/components/date-range';
import { isLocale } from '@/i18n/routing';
import { getMyWallet } from '@/lib/account';
import { formatMoney, localisedName, localisedText } from '@/lib/localise';
import { availablePaymentMethods, getProperty, quote } from '@/lib/property';
import { getSession } from '@/lib/session-server';

/**
 * Checkout (SRS §6.3 step 3 — the payment summary).
 *
 * Dynamic and never cached: the price is quoted live, and a stale total on a
 * checkout page is a total the customer would dispute. `noindex` because there is
 * nothing here worth crawling and the URL carries booking intent.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A whole number inside its bounds, or the fallback — never NaN, never negative. */
function whole(raw: string | undefined, fallback: number, max: number): number {
  const value = Number(raw);

  if (!Number.isFinite(value)) return fallback;

  return Math.min(Math.max(Math.trunc(value), 0), max);
}

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const query = await searchParams;
  const t = await getTranslations('checkout');
  const tp = await getTranslations('property');
  /* The guest plurals live with the search form that collects them, not with the summary. */
  const ts = await getTranslations('search');

  const slug = first(query['property']);
  const unitId = first(query['unitId']);
  const checkIn = first(query['checkIn']);
  const checkOut = first(query['checkOut']);
  const adults = Number(first(query['adults']) ?? 2);
  /*
    §5.2's other two, clamped the way the search page clamps them: the API bounds them again, but
    an unclamped `?children=abc` would reach the quote as NaN and turn a typo into an error page.
  */
  const children = whole(first(query['children']), 0, 20);
  const infants = whole(first(query['infants']), 0, 10);

  // Missing parameters mean the customer arrived here by a broken link rather than
  // through a property page. Say so plainly instead of rendering an empty form.
  if (!slug || !unitId || !checkIn || !checkOut) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="font-display text-xl text-text">{t('missingDetails')}</p>
        <Link
          href={`/${locale}/search`}
          className="mt-4 inline-block rounded-lg btn-gold px-5 py-2.5 font-semibold"
        >
          {t('backToSearch')}
        </Link>
      </div>
    );
  }

  const property = await getProperty(slug);
  if (!property) notFound();

  /**
   * The price is quoted by the API, not computed here.
   *
   * Recomputing it in the browser or on this page would create a second source of
   * truth for money, and the two would eventually disagree — at which point the
   * customer sees one total and is charged another.
   *
   * The offered payment methods come from the same round of requests: neither depends
   * on the other, so awaiting them in sequence would add latency for nothing (§3).
   */
  const [priced, methods, session] = await Promise.all([
    quote({ unitId, checkIn, checkOut }),
    availablePaymentMethods(property.city.countryCode),
    getSession(),
  ]);

  if (!priced) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="font-display text-xl text-bad">{t('unavailable')}</p>
        <p className="mt-2 text-sm text-muted">{t('unavailableHint')}</p>
        <Link
          href={`/${locale}/property/${slug}`}
          className="mt-4 inline-block rounded-lg border border-line px-5 py-2.5 text-muted"
        >
          {t('backToProperty')}
        </Link>
      </div>
    );
  }

  /**
   * The spendable balance, for signed-in customers only (§7.3).
   *
   * A guest is offered nothing, and that is a security decision rather than a
   * limitation: the booking access token proves possession of ONE booking, while a
   * wallet spans every booking on the profile and can hold compensation earned
   * elsewhere. The API refuses a guest's `applyWallet` for the same reason, so
   * offering it here would only produce a rejected payment.
   *
   * Only a balance in the booking's own currency counts. The API declines to convert
   * at checkout — the rate would move between page load and payment — so showing a
   * JOD balance against a USD stay would promise a discount that never arrives.
   */
  const walletResult = session ? await getMyWallet() : null;

  const balance =
    walletResult && walletResult !== 'failed' && walletResult !== 'unauthenticated'
      ? walletResult.wallet
      : null;

  const applicable =
    balance && balance.currencyCode === priced.currencyCode ? balance.balance : null;

  const name = localisedText(property.name, locale);
  const cityName = localisedName(property.city, locale);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold text-gold">{t('title')}</h1>
      <p className="mt-2 text-sm text-muted">{t('subtitle')}</p>

      {/*
        Both columns inside one provider: the coupon is ENTERED in the summary, where the money
        is, and SUBMITTED by the form. Without something between them the customer would see one
        total and pay another.
      */}
      <CouponProvider>
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem]">
          <CheckoutForm
            locale={locale}
            unitId={unitId}
            checkIn={checkIn}
            checkOut={checkOut}
            adults={adults}
            children={children}
            infants={infants}
            propertySlug={slug}
            methods={methods}
            wallet={
              applicable
                ? {
                    balance: applicable,
                    currencyCode: priced.currencyCode,
                    total: priced.totalAmount,
                  }
                : null
            }
            signedIn={session !== null}
          />

          {/* ── Payment summary (§6.3 step 3) ──────────────────────────────── */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-card border border-line bg-card p-5">
              <h2 className="font-display text-lg text-text">{t('summary')}</h2>
              <p className="mt-1 text-sm text-faint">
                {name} · {cityName}
              </p>
              <p className="text-sm text-faint">
                <DateRange from={checkIn} to={checkOut} locale={locale} /> ·{' '}
                {tp('totalFor', { nights: priced.nights })}
              </p>
              {/*
                §6.3 step 3 names EIGHT things this panel must show, and «عدد الضيوف» was the one it
                did not. The count was read off the query string and submitted, never rendered — so
                the last screen before somebody pays did not confirm how many people they were paying
                for. Found by the SRS audit, 2026-08-25.

                Each kind on its own, not a single total: «٤ ضيوف» cannot tell a family of four from
                two adults and two children, and the partner is preparing a room from this.
              */}
              <p className="text-sm text-faint">
                {t('guestsSummary')}: {ts('guestsCount', { count: adults })}
                {children > 0 ? <> · {ts('childrenCount', { count: children })}</> : null}
                {infants > 0 ? <> · {ts('infantsCount', { count: infants })}</> : null}
              </p>

              <div className="gold-rule my-4" />

              {/* Every night listed, so an override is visible rather than buried. */}
              <ul className="space-y-1 text-sm">
                {priced.nightly.map((night) => (
                  <li key={night.date} className="flex justify-between text-muted">
                    <span>{night.date}</span>
                    <span>{formatMoney(night.amount, priced.currencyCode, locale)}</span>
                  </li>
                ))}
              </ul>

              <div className="gold-rule my-4" />

              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">{t('subtotal')}</dt>
                  <dd className="text-text">
                    {formatMoney(priced.baseAmount, priced.currencyCode, locale)}
                  </dd>
                </div>
                {/*
                  Shown only when it is CHARGED.

                  Bashar asked for «رسوم خدمة سفرة» off the client UI (2026-09-03) and it is now
                  gone from the card, the property page and the home page — every surface where it
                  is a fact about the platform rather than about a payment. It stays here on the
                  condition below, because here it is money: `pricing.service.ts` computes
                  `grossMinor = baseMinor + customerFeeMinor`, so it is inside «المبلغ المستحق» and
                  a breakdown that omits it would show a subtotal and a total that do not
                  reconcile, with the difference unexplained.

                  Zero hides it. That is what makes the instruction reachable without lying about a
                  charge: setting `commission.customer_fee_value` to 0 removes the fee from the
                  customer's world everywhere at once, because there is then nothing to disclose.
                */}
                {Number(priced.customerFeeAmount) > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-muted">{tp('serviceFeeLabel')}</dt>
                    <dd className="text-text">
                      {formatMoney(priced.customerFeeAmount, priced.currencyCode, locale)}
                    </dd>
                  </div>
                ) : null}
                {/* Falls when a coupon applies — see `CheckoutTotal`. */}
                <CheckoutTotal
                  total={priced.totalAmount}
                  currencyCode={priced.currencyCode}
                  locale={locale}
                  label={t('dueNow')}
                  discountLabel={t('couponApplied')}
                />
              </dl>

              <CouponField
                locale={locale}
                unitId={unitId}
                checkIn={checkIn}
                checkOut={checkOut}
                currencyCode={priced.currencyCode}
                copy={{
                  label: t('couponLabel'),
                  placeholder: t('couponPlaceholder'),
                  apply: t('couponApply'),
                  applying: t('couponApplying'),
                  remove: t('couponRemove'),
                  applied: t('couponApplied'),
                  invalid: t('couponInvalid'),
                  /*
                    Resolved HERE, on the server, so the field carries no catalogue of its own and a
                    refusal reads in the customer's language rather than in the API's English.
                  */
                  messages: couponMessages(locale),
                }}
              />

              {/*
                §6.1: booking is not instant, and saying so BEFORE payment is the point.
                A customer who learns this after paying feels misled; one who knows in
                advance understands why SAFRA sits in the middle.
              */}
              <p className="mt-4 rounded-lg border border-sky/30 bg-sky/10 p-3 text-xs text-sky">
                {t('notInstant')}
              </p>
            </div>
          </aside>
        </div>
      </CouponProvider>
    </div>
  );
}
