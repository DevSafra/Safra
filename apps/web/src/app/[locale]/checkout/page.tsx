import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { customerFeeVisible } from '@safra/contracts';

import { dialOptions } from '@/lib/dial-options';
import { CheckoutForm } from '@/components/checkout-form';
import { CouponProvider } from '@/components/coupon-context';
import { CouponField } from '@/components/coupon-field';
import { CheckoutTotal } from '@/components/checkout-total';
import { couponMessages } from '@/lib/coupon-messages';
import { DateRange } from '@/components/date-range';
import { isLocale } from '@/i18n/routing';
import { getAccountSummary, getMyWallet } from '@/lib/account';
import { ltrIsolate } from '@/lib/bidi';
import { getPublicSettings } from '@/lib/catalog';
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

/**
 * «uuid:2,uuid:1» — the other room types on a basket booking.
 *
 * Strict on purpose. A caller-supplied string reaches a price quote, so anything that is not a
 * uuid and a small count is DROPPED rather than coerced: a line read as `NaN` rooms would quote a
 * stay nobody asked for, and `0` would put a room type on the booking with nothing in it. Five
 * extra types, matching the contract's own ceiling.
 */
function parseLines(raw: string | undefined): { unitId: string; rooms: number }[] {
  if (!raw) return [];

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  return raw
    .split(',')
    .slice(0, 5)
    .map((part) => {
      const [unitId = '', count = ''] = part.split(':');
      const rooms = Number(count);

      return { unitId, rooms };
    })
    .filter(
      (line) =>
        uuid.test(line.unitId) &&
        Number.isInteger(line.rooms) &&
        line.rooms >= 1 &&
        line.rooms <= 10,
    );
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
  /*
    How many rooms, clamped to the contract's own ceiling. The real limit is what the property has
    free, which only the API can know — it re-reads availability inside the transaction that takes
    the inventory, so a hand-typed `?rooms=9` is priced here and refused there with a sentence
    naming how many are left, rather than being quietly reduced to something nobody asked for.
  */
  /* `whole` floors at zero, which is right for children and wrong here — a stay is at least one room. */
  const rooms = Math.max(1, whole(first(query['rooms']), 1, 10));
  /*
    The OTHER room types on this booking — «uuid:2,uuid:1».
    
    A basket mixes types, and the lead pair above carries only the first. Parsed strictly: anything
    that is not a uuid and a count is dropped rather than coerced, because a malformed line would
    otherwise reach the quote as a room nobody chose. The API validates the same shape again and is
    the one that enforces.
  */
  const additionalLines = parseLines(first(query['lines']));

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
  const [priced, offered, session, settings] = await Promise.all([
    quote({
      unitId,
      checkIn,
      checkOut,
      rooms,
      lines: [{ unitId, rooms }, ...additionalLines],
    }),
    availablePaymentMethods(property.city.countryCode),
    getSession(),
    getPublicSettings(),
  ]);

  /* Whether the fee is NAMED here. The invoice reads the same setting the same way. */
  const feeVisible = customerFeeVisible(settings);

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
  const [walletResult, profileResult] = session
    ? await Promise.all([getMyWallet(), getAccountSummary()])
    : [null, null];

  const balance =
    walletResult && walletResult !== 'failed' && walletResult !== 'unauthenticated'
      ? walletResult.wallet
      : null;

  const applicable =
    balance && balance.currencyCode === priced.currencyCode ? balance.balance : null;

  /*
    The signed-in customer's own details, so the form does not ask for what we already hold.

    Bashar, 2026-09-07: «I do not want checkout fields that collect information and then ignore
    it.» It did exactly that — the three fields were typed, and `resolveCustomerProfile` returned
    the session's profile without reading one of them.

    A FAILED read falls back to an empty form rather than to blank fields presented as the profile:
    an unreachable profile service must not tell somebody their name is empty, and the guest path
    still collects everything the booking needs.
  */
  const account =
    profileResult && profileResult !== 'failed' && profileResult !== 'unauthenticated'
      ? {
          fullName: profileResult.fullName,
          email: profileResult.email,
          phone: profileResult.phone,
        }
      : null;

  const name = localisedText(property.name, locale);
  const cityName = localisedName(property.city, locale);

  /*
    WHICH ROOM, on the panel where the money is agreed (Bashar, 2026-09-06).

    The summary named the property and the city and never the unit. On a one-room listing that was
    merely terse; on a thirteen-room hotel it is the whole question — a guest who chose «جناح
    تنفيذي» saw «فندق أمية الكبير · دمشق» and a price, with nothing on the page confirming they were
    not buying the standard double. The right room WAS being quoted; it simply was not named.

    Invisible until the testbed grew a realistic hotel, because every fixture had one unit and the
    property name was therefore also the room's.

    Falls back to nothing rather than to a guess: an id that matches no unit is a bad link, and the
    quote above has already refused it.
  */
  const chosenUnit = property.units.find((one) => one.id === unitId);
  const unitName = chosenUnit ? localisedText(chosenUnit.name, locale) : null;

  /*
    EVERY room type on this booking, named and priced — from the QUOTE, not from the query string.
    
    A basket may hold «مزدوجة × 2، جناح × 1», and a summary naming only the lead type would be
    asking somebody to pay a total whose largest component is invisible. Read back from the priced
    answer so the lines shown are the lines charged, even if the link was edited on the way here.
  */
  const basket = priced.lines.map((line) => {
    const unit = property.units.find((one) => one.id === line.unitId);

    return {
      unitId: line.unitId,
      name: unit ? localisedText(unit.name, locale) : line.unitId,
      rooms: line.rooms,
      amount: line.amount,
    };
  });

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
            countries={dialOptions(locale)}
            locale={locale}
            unitId={unitId}
            rooms={rooms}
            additionalLines={additionalLines}
            checkIn={checkIn}
            checkOut={checkOut}
            adults={adults}
            children={children}
            infants={infants}
            propertySlug={slug}
            methods={offered.methods}
            offlineRail={offered.offline}
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
            account={account}
          />

          {/* ── Payment summary (§6.3 step 3) ──────────────────────────────── */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-card border border-line bg-card p-5">
              <h2 className="font-display text-lg text-text">{t('summary')}</h2>
              <p className="mt-1 text-sm text-faint">
                {name} · {cityName}
              </p>
              {/*
                One line per room TYPE, with its quantity and its subtotal.

                It used to print the lead type's name alone. On a single-type booking that is the
                whole truth; on a basket it names one of several, and «المجموع» below would be a
                figure with no working shown. Renders as a plain list rather than the lead name
                when there is only one line, so nothing changes for the ordinary booking.
              */}
              {basket.length === 1 && unitName ? (
                <p className="text-sm font-semibold text-text2">
                  {unitName}
                  {basket[0]!.rooms > 1
                    ? ` · ${tp('unitsCount', { count: basket[0]!.rooms })}`
                    : ''}
                </p>
              ) : (
                <ul data-checkout-basket className="mt-1 grid gap-1">
                  {basket.map((line) => (
                    <li
                      key={line.unitId}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm"
                    >
                      <span className="font-semibold text-text2">
                        {line.name} · {tp('unitsCount', { count: line.rooms })}
                      </span>
                      <span className="tabular-nums text-muted">
                        {formatMoney(line.amount, priced.currencyCode, locale, {
                          exact: true,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-sm text-faint">
                <DateRange from={checkIn} to={checkOut} locale={locale} /> ·{' '}
                {tp('totalFor', { nights: priced.nights })}
              </p>
              {/*
                How many rooms, from the QUOTE rather than from the query string.

                The last screen before somebody pays must confirm what they are paying for, and the
                room count is now part of that — a stay priced for three rooms and described as one
                is the same defect «عدد الضيوف» was, one field along. Reading it back from the
                priced answer means the number shown is the number charged, even if the link was
                edited between the property page and here.
              */}
              {priced.rooms > 1 ? (
                <p className="text-sm text-faint">
                  {tp('summaryRooms')}: {tp('unitsCount', { count: priced.rooms })}
                </p>
              ) : null}
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

              {/*
                The DATES are listed, the per-night AMOUNTS are not.

                Bashar, 2026-09-03: «the total/final price should only be displayed to the
                customer/guest.» The amounts were the last place the service fee remained visible —
                not by name, by SUBTRACTION: four nights adding to 100 above a total of 101.99
                states the fee as plainly as a row labelled with it, and more confusingly, because
                nothing accounts for the difference.

                The dates stay because they are not a price. «An override is visible rather than
                buried» was this list's original reason, and a partner's date-by-date override is
                still visible — in the nightly rate on the property page, before anybody reaches a
                checkout.
              */}
              <div className="gold-rule my-4" />

              <ul className="space-y-1 text-sm">
                {priced.nightly.map((night) => (
                  <li key={night.date} className="flex justify-between gap-4">
                    {/*
                      A date on its own line, between two rules, naming nothing — which is what it
                      became when the amounts went (Bashar, 2026-09-03, with the screenshot). Every
                      other line in this panel is a caption at the start and its value at the end;
                      this one now reads the same way.
                    */}
                    <span className="text-muted">{t('nightLabel')}</span>
                    {/*
                      Isolated, and the DATE only. «2026-09-03» is a left-to-right run of digits and
                      hyphens; unisolated next to Arabic the bidi algorithm can reorder it, and the
                      year ends up on the wrong end. Never isolate the label with it — that would
                      put the caption inside the same run and reverse the pair.
                    */}
                    <span className="text-text2">{ltrIsolate(night.date)}</span>
                  </li>
                ))}
              </ul>

              <div className="gold-rule my-4" />

              {/*
                The nights, then what is due — with the fee itemised between them or not, according
                to `commission.customer_fee_visible`.

                «رسوم خدمة سفرة» was a hard-coded row here, removed on Bashar's instruction
                (2026-09-03) and now switchable (2026-09-04). What matters either way is that the
                rows RECONCILE: the two lines are `baseAmount` and `customerFeeAmount`, which sum
                exactly to `totalAmount`, and a coupon subtracts from the total through
                `CheckoutTotal`'s own discount row. The earlier version of this screen showed a
                subtotal with no fee beside it — «المجموع الفرعي 100» above «المبلغ المستحق 101.99»,
                two figures that do not reconcile and nothing accounting for the gap, which states
                the fee to anybody who subtracts and states it as an error. So the pair moves
                together: either both lines or neither, never the base alone.

                The fee is charged, recorded and posted identically in both modes. This is a
                display decision and nothing else.
              */}
              <dl className="space-y-2 text-sm">
                {feeVisible ? (
                  <>
                    <div className="flex justify-between">
                      <dt className="text-muted">{t('accommodation')}</dt>
                      <dd className="text-text2">
                        {formatMoney(priced.baseAmount, priced.currencyCode, locale, {
                          exact: true,
                        })}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">{t('serviceFee')}</dt>
                      <dd className="text-text2">
                        {formatMoney(
                          priced.customerFeeAmount,
                          priced.currencyCode,
                          locale,
                        )}
                      </dd>
                    </div>
                  </>
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
                rooms={rooms}
                additionalLines={additionalLines}
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
