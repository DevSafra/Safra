import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { isLocale, routing, type Locale } from '@/i18n/routing';
import { SaveButton } from '@/components/save-button';
import { formatMoney, localisedName, localisedText } from '@/lib/localise';
import { getProperty, imageUrl, type PropertyDetail } from '@/lib/property';
import { dynamicMessage } from '@/lib/dynamic-message';

/**
 * Property page (SRS §5.6).
 *
 * Required by the spec and all present here: images, description, map location,
 * amenities, cancellation policy, nightly price, total price, SAFRA's fees, the
 * availability calendar with its four states, and the trust badges.
 *
 * Deliberately ABSENT: any way to contact the partner. §5.6 and principle P-001 are
 * explicit that no direct contact details appear before a booking is confirmed —
 * the customer's relationship is with SAFRA. So the actions are "Book now" and
 * "Ask SAFRA", never a phone number.
 */
export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};

  const property = await getProperty(slug);
  if (!property) return {};

  const name = localisedText(property.name, locale);
  const description = localisedText(property.description, locale);

  return {
    title: name,
    description: description?.slice(0, 160) ?? undefined,
    alternates: {
      canonical: `/${locale}/property/${slug}`,
      languages: Object.fromEntries(
        routing.locales.map((l) => [l, `/${l}/property/${slug}`]),
      ),
    },
    openGraph: {
      title: name,
      description: description?.slice(0, 200) ?? undefined,
      type: 'website',
      images: property.images[0]
        ? [{ url: imageUrl(property.images[0], 1600) }]
        : undefined,
    },
  };
}

export default async function PropertyPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const property = await getProperty(slug);
  if (!property) notFound();

  const t = await getTranslations('property');
  const tnav = await getTranslations('nav');
  const ta = await getTranslations('amenities');
  const tt = await getTranslations('propertyTypes');
  const tc = await getTranslations('city');
  const tcal = await getTranslations('calendar');

  const name = localisedText(property.name, locale);
  const description = localisedText(property.description, locale);
  const cityName = localisedName(property.city, locale);
  const cheapest = property.units[0];
  const defaultStay = firstAvailableWindow(property.calendar, cheapest?.minNights ?? 1);

  return (
    <article className="mx-auto max-w-6xl px-4 py-8">
      <nav aria-label={tnav('breadcrumb')} className="text-sm text-faint">
        {/* Both breadcrumb links are controls — see the note on the city page. */}
        <Link
          href={`/${locale}`}
          className="inline-flex min-h-10 items-center hover:text-gold lg:min-h-0"
        >
          {tc('backHome')}
        </Link>
        <span aria-hidden className="mx-2">
          ←
        </span>
        <Link
          href={`/${locale}/city/${property.city.slug}`}
          className="inline-flex min-h-10 items-center hover:text-gold lg:min-h-0"
        >
          {cityName}
        </Link>
        <span aria-hidden className="mx-2">
          ←
        </span>
        <span className="text-muted">{name}</span>
      </nav>

      {/* ── Gallery ────────────────────────────────────────────────────────── */}
      <Gallery property={property} locale={locale} name={name} />

      <header className="mt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold text-gold sm:text-4xl">
              {name}
            </h1>
            <p className="mt-2 text-sm text-muted">
              {dynamicMessage(tt, property.propertyTypeCode, property.propertyTypeCode)} ·{' '}
              {cityName}
              {property.rating ? ` · ★ ${property.rating}` : ''}
              {property.reviewsCount > 0
                ? ` · ${t('reviews', { count: property.reviewsCount })}`
                : ''}
              {' · '}
              <span className="text-faint">{property.reference}</span>
            </p>

            {/*
              Save to المفضلة.

              No `initiallySaved`: this page is cached (`revalidate = 60`), so its HTML is shared
              between readers and must carry nobody's shortlist. The button asks for its own state
              after mounting, which keeps the page cacheable.
            */}
            <div className="mt-3">
              <SaveButton
                slug={property.slug}
                labels={{
                  save: t('save'),
                  saved: t('saved'),
                  failed: t('saveFailed'),
                }}
              />
            </div>
          </div>

          {property.badges.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {property.badges.map((badge) => (
                <li
                  key={badge}
                  className="rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-xs text-gold"
                >
                  {badge === 'safra_verified' ? t('badgeVerified') : t('badgeRecommends')}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-8">
          {description ? (
            <section>
              <p className="whitespace-pre-line text-muted">{description}</p>
            </section>
          ) : null}

          {/* ── Amenities (§5.6) ──────────────────────────────────────────── */}
          {cheapest && cheapest.amenityCodes.length > 0 ? (
            <section>
              <h2 className="font-display text-xl text-text">{t('amenities')}</h2>
              <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {cheapest.amenityCodes.map((code) => (
                  <li key={code} className="flex items-center gap-2 text-sm text-muted">
                    <span aria-hidden className="text-ok">
                      ✓
                    </span>
                    {dynamicMessage(ta, code, code)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* ── Availability calendar with all four states (§5.6) ─────────── */}
          <section>
            <h2 className="font-display text-xl text-text">{tcal('title')}</h2>
            <ol className="mt-4 flex flex-wrap gap-1.5">
              {property.calendar.slice(0, 28).map((day) => (
                <li
                  key={day.date}
                  title={`${day.date} · ${tcal(day.status)}`}
                  className={`flex w-14 flex-col items-center rounded-lg border px-1 py-1.5 text-center ${dayClasses(day.status)}`}
                >
                  <span className="text-[10px] opacity-70">{day.date.slice(8)}</span>
                  <span aria-hidden className="text-xs">
                    {dayGlyph(day.status)}
                  </span>
                </li>
              ))}
            </ol>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-faint">
              {(['available', 'booked', 'closed', 'maintenance'] as const).map(
                (state) => (
                  <li key={state} className="flex items-center gap-1.5">
                    <span aria-hidden className={legendDot(state)}>
                      ●
                    </span>
                    {tcal(state)}
                  </li>
                ),
              )}
            </ul>
          </section>

          {/* ── Cancellation policy (§7.4) ────────────────────────────────── */}
          <section>
            <h2 className="font-display text-xl text-text">{t('cancellationPolicy')}</h2>
            <div className="mt-3 rounded-card border border-line bg-card p-5">
              <p className="font-semibold text-text">
                {policyName(property.cancellationPolicy, locale)}
              </p>
              <p className="mt-1 text-sm text-muted">
                {policyDescription(property.cancellationPolicy, locale)}
              </p>
              <p className="mt-3 text-xs text-faint">
                {t('refundFloor', {
                  percent: property.cancellationPolicy.minRefundPercent,
                })}
              </p>
            </div>
          </section>

          {/* ── Location, deliberately approximate (§5.6, P-001) ──────────── */}
          <section>
            <h2 className="font-display text-xl text-text">{t('location')}</h2>
            <div className="mt-3 rounded-card border border-line bg-card p-5">
              <p className="text-sm text-muted">
                {property.addressApproximate}, {cityName}
              </p>
              <p className="mt-2 text-xs text-faint">{t('exactLocationAfterBooking')}</p>
            </div>
          </section>

          {/* ── What guests said (§5.6, §7.3) ──────────────────────────────── */}
          <section>
            <h2 className="font-display text-xl text-text">{t('reviewsTitle')}</h2>

            {property.reviews.length === 0 ? (
              <p className="mt-3 text-sm text-faint">{t('reviewsEmpty')}</p>
            ) : (
              <>
                {/*
                  The sample is named as a sample. `reviewsCount` is the trigger-maintained total
                  over published reviews, so "the 10 most recent of 132" cannot drift from the ★
                  beside the title — both come from the same aggregate.
                */}
                <p className="mt-1 text-xs text-faint">
                  {t('reviewsShowing', {
                    shown: property.reviews.length,
                    total: property.reviewsCount,
                  })}
                </p>

                <ul className="mt-3 space-y-3">
                  {property.reviews.map((review) => (
                    <li
                      key={review.reference}
                      className="rounded-card border border-line bg-card p-5"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-sm font-semibold text-text">
                          {review.author ?? ''}
                        </span>
                        {/*
                          `dir="ltr"`: a ★ followed by a digit is a Latin run, and the star is
                          bidi-neutral — without this it lands on the wrong side of the number.
                        */}
                        <span dir="ltr" className="text-sm font-bold text-gold">
                          <span aria-hidden>★</span> {review.rating}
                        </span>
                        <span className="text-xs text-faint">{t('reviewsVerified')}</span>
                        <span className="ms-auto text-xs text-faint">
                          {review.createdAt.slice(0, 10)}
                        </span>
                      </div>

                      <p className="mt-2 text-sm leading-relaxed text-muted">
                        {review.body}
                      </p>

                      {review.partnerReply ? (
                        <div className="mt-3 rounded-lg border border-gold/30 bg-gold/5 px-4 py-3">
                          <p className="text-xs font-semibold text-gold">
                            {t('reviewsPartnerReply')}
                          </p>
                          <p className="mt-1 text-sm leading-relaxed text-muted">
                            {review.partnerReply}
                          </p>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        {/* ── Booking panel ─────────────────────────────────────────────────── */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-card border border-gold/30 bg-card p-5">
            {cheapest ? (
              <>
                <p className="text-2xl font-semibold text-gold">
                  {formatMoney(cheapest.basePrice, cheapest.currencyCode, locale)}
                  <span className="ms-1 text-sm font-normal text-faint">
                    {t('perNight')}
                  </span>
                </p>
                <p className="mt-1 text-sm text-muted">
                  {t('guestsUpTo', { count: cheapest.maxGuests })}
                </p>

                <div className="gold-rule my-4" />

                {/*
                  SAFRA's fee, read from settings rather than hardcoded — the super
                  admin sets it on the Rules Engine page (P-005).
                */}
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted">{t('serviceFeeLabel')}</dt>
                    <dd className="text-text">
                      {property.fees.customerFeeMode === 'flat'
                        ? formatMoney(
                            property.fees.customerFeeValue.toFixed(2),
                            cheapest.currencyCode,
                            locale,
                          )
                        : `${(property.fees.customerFeeValue * 100).toFixed(0)}%`}
                    </dd>
                  </div>
                </dl>

                {/*
                  Carries the unit and a concrete date range, because checkout needs
                  both to quote a price. The first bookable window from the calendar is
                  used as the default so the link always lands on something valid.
                */}
                <Link
                  href={`/${locale}/checkout?property=${property.slug}&unitId=${cheapest.id}&checkIn=${defaultStay.checkIn}&checkOut=${defaultStay.checkOut}&adults=${Math.min(2, cheapest.maxGuests)}`}
                  className="mt-5 block rounded-lg bg-gold px-5 py-3 text-center font-semibold text-bg transition-opacity hover:opacity-90"
                >
                  {t('bookNow')}
                </Link>

                {/*
                  "Ask SAFRA", never "contact the property". §5.6 and P-001 forbid
                  exposing partner contact details before confirmation.
                */}
                <Link
                  href={`/${locale}/support?property=${property.reference}`}
                  className="mt-2 block rounded-lg border border-line px-5 py-3 text-center text-sm text-muted transition-colors hover:border-gold hover:text-gold"
                >
                  {t('askSafra')}
                </Link>

                <p className="mt-4 text-xs text-faint">{t('notInstantNotice')}</p>
              </>
            ) : (
              <p className="text-sm text-muted">{t('noUnits')}</p>
            )}
          </div>
        </aside>
      </div>
    </article>
  );
}

function Gallery({
  property,
  locale,
  name,
}: {
  property: PropertyDetail;
  locale: Locale;
  name: string;
}) {
  if (property.images.length === 0) {
    return (
      <div
        aria-hidden
        className="mt-6 h-64 rounded-card border border-line bg-[radial-gradient(ellipse_at_50%_0%,color-mix(in_oklab,var(--color-sky)_22%,transparent),transparent_70%)] sm:h-80"
      />
    );
  }

  const [cover, ...rest] = property.images;

  return (
    <div className="mt-6 grid gap-2 sm:grid-cols-[2fr_1fr]">
      {cover ? (
        <picture>
          {/* AVIF first, WebP as the fallback — both produced by the upload pipeline. */}
          <source srcSet={imageUrl(cover, 1600, 'avif')} type="image/avif" />
          <source srcSet={imageUrl(cover, 1600, 'webp')} type="image/webp" />
          <img
            src={imageUrl(cover, 1600, 'webp')}
            alt={localisedText(cover.alt, locale) ?? name}
            width={cover.width ?? 1600}
            height={cover.height ?? 1000}
            className="h-64 w-full rounded-card border border-line object-cover sm:h-80"
            loading="eager"
          />
        </picture>
      ) : null}

      {rest.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-1">
          {rest.slice(0, 2).map((image) => (
            <li key={image.fileKey}>
              <picture>
                <source srcSet={imageUrl(image, 800, 'avif')} type="image/avif" />
                <source srcSet={imageUrl(image, 800, 'webp')} type="image/webp" />
                <img
                  src={imageUrl(image, 800, 'webp')}
                  alt={localisedText(image.alt, locale) ?? name}
                  width={image.width ?? 800}
                  height={image.height ?? 600}
                  className="h-32 w-full rounded-card border border-line object-cover sm:h-[9.5rem]"
                  loading="lazy"
                />
              </picture>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function policyName(
  policy: PropertyDetail['cancellationPolicy'],
  locale: Locale,
): string {
  if (locale === 'en') return policy.nameEn;
  if (locale === 'de') return policy.nameDe;
  return policy.nameAr;
}

function policyDescription(
  policy: PropertyDetail['cancellationPolicy'],
  locale: Locale,
): string {
  if (locale === 'en') return policy.descriptionEn;
  if (locale === 'de') return policy.descriptionDe;
  return policy.descriptionAr;
}

/**
 * Amenity labels come from a fixed message namespace, but the codes come from the
 * database — an admin can add one before a translation exists. Falling back to the
 * raw code beats crashing the page.
 */
function dayClasses(status: string): string {
  if (status === 'available') return 'border-ok/40 bg-ok/10 text-ok';
  if (status === 'booked') return 'border-pend/40 bg-pend/10 text-pend';
  if (status === 'maintenance') return 'border-warn/40 bg-warn/10 text-warn';
  return 'border-line bg-field text-faint';
}

function legendDot(status: string): string {
  if (status === 'available') return 'text-ok';
  if (status === 'booked') return 'text-pend';
  if (status === 'maintenance') return 'text-warn';
  return 'text-faint';
}

function dayGlyph(status: string): string {
  if (status === 'available') return '✓';
  if (status === 'booked') return '●';
  if (status === 'maintenance') return '⚒';
  return '×';
}

/**
 * The first run of consecutive available days long enough to satisfy minNights.
 *
 * Linking "Book now" at today's date would often land on a closed or booked night and
 * greet the customer with an error on the checkout page. Finding a genuinely bookable
 * window from the calendar this page already loaded costs nothing and means the button
 * always works.
 */
function firstAvailableWindow(
  calendar: PropertyDetail['calendar'],
  minNights: number,
): { checkIn: string; checkOut: string } {
  const required = Math.max(minNights, 1);
  let runStart: string | null = null;
  let runLength = 0;

  for (const day of calendar) {
    if (day.status === 'available') {
      runStart ??= day.date;
      runLength += 1;

      if (runLength >= required && runStart) {
        return { checkIn: runStart, checkOut: shiftDate(runStart, required) };
      }
    } else {
      runStart = null;
      runLength = 0;
    }
  }

  // Nothing bookable within the calendar window. Checkout will quote these dates and
  // report the real reason, rather than this page guessing at one.
  const fallback = calendar[0]?.date ?? new Date().toISOString().slice(0, 10);
  return { checkIn: fallback, checkOut: shiftDate(fallback, required) };
}

/** Calendar arithmetic on a date-only value; UTC avoids any DST component. */
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
