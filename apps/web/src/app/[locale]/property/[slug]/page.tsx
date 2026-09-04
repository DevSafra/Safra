import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { isLocale, routing, type Locale } from '@/i18n/routing';
import { SaveButton } from '@/components/save-button';
import { ShareButton } from '@/components/share-button';
import { PropertyGallery } from '@/components/property-gallery';
import { priceWithCustomerFee } from '@/lib/customer-fee';
import { localisedName, localisedText } from '@/lib/localise';
import { getProperty, imageUrl, type PropertyDetail } from '@/lib/property';
import { dynamicMessage } from '@/lib/dynamic-message';
import { getCurrencyCatalogue } from '@/lib/catalog';
import { convertForDisplay, displayCurrency } from '@/lib/currency';

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

/** The first value of a repeatable query parameter, or nothing. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A whole number inside its bounds, or the fallback — never NaN, never negative. */
function whole(raw: string | undefined, fallback: number, max: number): number {
  const value = Number(raw);

  if (!Number.isFinite(value)) return fallback;

  return Math.min(Math.max(Math.trunc(value), 0), max);
}

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
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, slug } = await params;
  const query = await searchParams;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  /*
    §5.2 — the party the reader searched with, clamped on the way through.

    Absent when somebody arrives here from a bookmark or a city page, which is why every one has a
    fallback: this screen must render for a reader who has not searched at all.
  */
  const adults = whole(first(query['adults']), 2, 30) || 2;
  const children = whole(first(query['children']), 0, 20);
  const infants = whole(first(query['infants']), 0, 10);

  const property = await getProperty(slug);
  if (!property) notFound();

  /*
    Where sign-in returns somebody who pressed «حفظ في المفضلة» without an account.

    Built from the values PARSED above, never from the raw query string — the same allow-list rule
    `PropertyCard`'s `stay` prop and the console's `returnQuery` both state: a redirect target
    assembled from whatever a crafted link happened to carry is how a control becomes an open
    redirect.

    The party travels with it. Returning them to a bare property URL would drop the dates and the
    guests they searched with, and a family of four would come back as a party of two — which is
    the defect the SRS audit found on this exact path in 2026-08-25.
  */
  const stay = new URLSearchParams({
    adults: String(adults),
    children: String(children),
    infants: String(infants),
  });

  /*
    The dates are carried by SHAPE, because this page does not otherwise parse them — it prices
    from `defaultStay`, computed off the calendar. `YYYY-MM-DD` or nothing: a shape test is an
    allow-list, and it cannot pass through anything that is not a date.
  */
  for (const key of ['checkIn', 'checkOut'] as const) {
    const value = first(query[key]);

    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) stay.set(key, value);
  }

  const backHere = `/${locale}/property/${property.slug}?${stay.toString()}`;

  const t = await getTranslations('property');
  const tnav = await getTranslations('nav');
  const ta = await getTranslations('amenities');
  const tt = await getTranslations('propertyTypes');
  const tc = await getTranslations('city');
  const tcal = await getTranslations('calendar');

  const name = localisedText(property.name, locale);
  const description = localisedText(property.description, locale);
  const cityName = localisedName(property.city, locale);
  /*
    The word beside the number. A bare «4.8» asks the reader to know what the scale is; the word is
    what makes it a judgement. Thresholds on a FIVE-point scale — this platform's reviews are out of
    five, not out of ten, so booking.com's own 9.0/8.0 boundaries do not transfer.
  */
  const score = Number(property.rating ?? 0);
  const scoreWord = t(
    score >= 4.5
      ? 'scoreExcellent'
      : score >= 4
        ? 'scoreVeryGood'
        : score >= 3.5
          ? 'scoreGood'
          : 'scoreFair',
  );

  /* The most recent review with something to read; a one-word review is not a highlight. */
  const highlight = property.reviews?.find((one) => (one.body ?? '').trim().length > 40);

  const cheapest = property.units[0];
  const defaultStay = firstAvailableWindow(property.calendar, cheapest?.minNights ?? 1);

  /*
    The visitor's chosen currency, and the rates that reach it. Both reads are cached for five
    minutes and deduplicated per request, so this costs nothing the page was not already paying.
  */
  const common = await getTranslations('common');
  const [{ rates }, target] = await Promise.all([
    getCurrencyCatalogue(),
    displayCurrency(),
  ]);

  /*
    The fee is IN the figure, as it is in every card (Bashar, 2026-09-03).

    `basePrice` is the partner's own rate and stays that in the payload; the fee is applied here,
    at the point of display, from the rule the same endpoint sends. A flat fee is per BOOKING, so a
    per-night «from» price carries the whole of it — which is exact for the one-night stay the
    figure is a floor for, and never understates a longer one.
  */
  const nightly = convertForDisplay(
    cheapest
      ? priceWithCustomerFee(cheapest.basePrice, cheapest.currencyCode, property.fees)
      : '0',
    cheapest?.currencyCode ?? 'USD',
    locale,
    target,
    rates,
  );

  return (
    <article className="mx-auto max-w-7xl px-4 py-8">
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
              The address, on its own line under the name — booking.com's arrangement, and it earns
              the line: «where is it» is the second question anybody asks and it was buried in a
              section two screens down.

              It jumps to that section rather than opening a map, because there is no map yet:
              `MAPTILER_KEY` is not in the environment. The link is honest about where it goes, and
              the section it lands on is the one that also says the exact address arrives after
              booking (§5.6, P-001) — which is the part a pin would otherwise imply away.
            */}
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <PinIcon />
              <span>
                {property.addressApproximate}, {cityName}
              </span>
              <a
                href="#location"
                className="inline-flex min-h-10 items-center font-semibold text-gold underline decoration-gold/40 underline-offset-2 lg:min-h-0 hover:decoration-gold"
              >
                {t('location')}
              </a>
            </p>
          </div>

          {/*
            The actions at the reading END, opposite the name — booking.com's own arrangement, and
            it is not arbitrary: the name answers «what is this» and belongs where the eye starts,
            the action answers «and now what» and belongs where it finishes.

            **Share and save, not book** (Bashar, 2026-09-04). «احجز الآن» stood here as an ANCHOR
            to the panel three screens down — never a second booking form, because two places to
            book one stay is two places to keep in step. The panel is where the dates and the price
            are, and it carries the real action; a link to it that looked identical to it was the
            weaker half of a duplicated call.

            What is left is the pair that belongs together: the two things a reader does TO a
            listing rather than with it. It is also booking.com's own arrangement.

            **The one thing given up**: on a phone the booking panel is below the fold, and this was
            the only prompt above it. Worth watching — if it costs bookings, the answer is a sticky
            bar at the foot of the viewport rather than putting this back, because that is the
            pattern that keeps the action visible without duplicating it.
          */}
          <div className="flex flex-wrap items-center gap-2">
            <ShareButton
              labels={{
                share: t('share'),
                copied: t('shareCopied'),
                failed: t('shareFailed'),
              }}
            />

            {/*
              «حفظ في المفضلة» (Bashar, 2026-09-03). It sat under the name before, in the column
              that answers «what is this» — and saving is not a fact about the listing, it is
              something the reader does to it.

              No `initiallySaved`: this page is cached (`revalidate = 60`), so its HTML is shared
              between readers and must carry nobody's shortlist. The button asks for its own state
              after mounting, which keeps the page cacheable.
            */}
            <SaveButton
              slug={property.slug}
              signInHref={`/${locale}/login?next=${encodeURIComponent(backHere)}`}
              labels={{
                save: t('save'),
                saved: t('saved'),
                failed: t('saveFailed'),
              }}
            />
          </div>
        </div>

        {property.badges.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
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
      </header>

      {/* ── Gallery ────────────────────────────────────────────────────────── */}
      <Gallery property={property} locale={locale} name={name} t={t} />

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
              {/*
                Bordered boxes, as booking.com draws them — a grid of bordered cells is scannable in
                a way a bulleted list is not, and this is a list people scan for one word.

                **No icon, deliberately.** The reference gives each amenity its own glyph; the
                `amenities` catalogue carries an `icon` column and it is populated for **0 of 12**
                rows, so the honest alternatives were twelve identical marks or none. Twelve
                identical ticks is decoration pretending to be information. The `✓` that used to sit
                here was worse still: a unicode glyph standing in for an icon system, which is the
                one substitution the craft floor names outright.

                Distinct icons need either that column filled or an icon library adopted; both are
                recorded rather than faked.
              */}
              <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {cheapest.amenityCodes.map((code) => (
                  <li
                    key={code}
                    className="rounded-lg border border-line bg-card px-3 py-2.5 text-sm text-text"
                  >
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
          <section id="location" className="scroll-mt-28">
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
        {/*
          `scroll-mt` so the sticky header does not land on top of the panel the anchor just jumped
          to — the same reason every row on the console carries one.
        */}
        <aside id="booking" className="scroll-mt-28 lg:sticky lg:top-24 lg:self-start">
          {/*
            The score, the count, and one thing a guest actually said — booking.com's card, and the
            reason it sits ABOVE the price is that it answers the question the price provokes. A
            rating with no sentence under it is a number; a sentence with a name under it is a
            reason.
            
            One review, not a carousel: the full set is a section further down, and a panel that
            paged through them would compete with the thing beside it for the same attention.
          */}
          {property.rating ? (
            <div className="mb-3 rounded-card border border-line bg-card p-5">
              <div className="flex items-center gap-3">
                <span className="btn-gold grid min-w-11 place-items-center rounded-lg px-2.5 py-1.5 text-lg font-bold">
                  {property.rating}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-text">{scoreWord}</span>
                  {property.reviewsCount > 0 ? (
                    <span className="block text-xs text-muted">
                      {t('reviews', { count: property.reviewsCount })}
                    </span>
                  ) : null}
                </span>
              </div>

              {highlight ? (
                <figure className="mt-4 border-t border-line pt-4">
                  <figcaption className="text-xs font-semibold text-muted">
                    {t('guestsLoved')}
                  </figcaption>
                  {/*
                    A real quotation mark pair, not the ASCII kind, and the body is clamped to three
                    lines: a panel quote is a snippet somebody reads at a glance, and the whole
                    review is one section down for anybody who wants it.
                  */}
                  <blockquote className="mt-2 line-clamp-3 text-sm leading-relaxed text-text">
                    “{highlight.body}”
                  </blockquote>
                  {highlight.author ? (
                    <p className="mt-2 text-xs text-faint">{highlight.author}</p>
                  ) : null}
                </figure>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-card border border-gold/30 bg-card p-5">
            {cheapest ? (
              <>
                <p className="text-2xl font-semibold text-gold">
                  {nightly.text}
                  <span className="ms-1 text-sm font-normal text-faint">
                    {t('perNight')}
                  </span>
                </p>
                {/*
                  The listing's own currency, printed whenever the figure above is not it.

                  A browse price converts so it can be compared; the amount a booking is actually
                  made against is this one, and checkout will show it. Omitting this line would
                  turn an estimate into what looks like a quote.
                */}
                {nightly.converted ? (
                  <p className="mt-1 text-xs text-faint">
                    {common('convertedFrom', { amount: nightly.original })}
                  </p>
                ) : null}
                <p className="mt-1 text-sm text-muted">
                  {t('guestsUpTo', { count: cheapest.maxGuests })}
                </p>

                <div className="gold-rule my-4" />

                {/*
                  Carries the unit and a concrete date range, because checkout needs
                  both to quote a price. The first bookable window from the calendar is
                  used as the default so the link always lands on something valid.
                */}
                <Link
                  href={`/${locale}/checkout?property=${property.slug}&unitId=${cheapest.id}&checkIn=${defaultStay.checkIn}&checkOut=${defaultStay.checkOut}&adults=${Math.min(adults, cheapest.maxGuests)}&children=${children}&infants=${infants}`}
                  className="mt-5 block rounded-lg btn-gold px-5 py-3 text-center font-semibold transition-opacity hover:opacity-90"
                >
                  {t('bookNow')}
                </Link>

                {/*
                  "Ask SAFRA", never "contact the property". §5.6 and P-001 forbid
                  exposing partner contact details before confirmation.
                */}
                <Link
                  /*
                    `/account/support`, which is where الدعم actually lives.

                    This pointed at `/${locale}/support` — a route that has never existed — so
                    «اسأل سفرة» on every property page answered 404. Found by sweeping every
                    internal link against the routes each app really serves (2026-08-29); nothing
                    HTTP-level could see it, because the page around it returns 200.

                    The `?property=` it also carried is gone: the support screen reads `cursor` and
                    nothing else, so it was a parameter that looked handled and was not. Prefilling
                    the question with the property is a real improvement and a separate decision.
                  */
                  href={`/${locale}/account/support`}
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

/** A location mark, in the stroke weight the rest of the product's icons are drawn at. */
function PinIcon() {
  return (
    <svg
      aria-hidden
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-gold"
    >
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function Gallery({
  property,
  locale,
  name,
  t,
}: {
  property: PropertyDetail;
  locale: Locale;
  name: string;
  /* The page's own `property` namespace, so this reads the same catalogue as everything above. */
  t: Awaited<ReturnType<typeof getTranslations<'property'>>>;
}) {
  if (property.images.length === 0) {
    return (
      <div
        aria-hidden
        className="mt-6 h-64 rounded-card border border-line bg-[radial-gradient(ellipse_at_50%_0%,color-mix(in_oklab,var(--color-sky)_22%,transparent),transparent_70%)] sm:h-80"
      />
    );
  }

  /*
    EVERY photograph, not the three the grid has room for.

    The grid shows a cover and two thumbnails — right for the first paint, and wrong as the only
    thing a person can see: a listing with fourteen photographs published eleven that nobody could
    reach. The previewer is `@safra/ui`'s, per the project rule on one slider.
  */
  const slides = property.images.map((image) => ({
    id: image.fileKey,
    thumb: imageUrl(image, 800, 'webp'),
    full: imageUrl(image, 1600, 'webp'),
    ...(localisedText(image.alt, locale)
      ? { caption: localisedText(image.alt, locale) }
      : {}),
  }));

  /*
    The mosaic's own sources. `SliderImage` carries what the PREVIEWER needs — one thumb and one
    full render — and a tile needs the `<picture>` pair the pipeline produced, so the two travel
    side by side rather than one pretending to be the other.

    The cover asks for 1600px because it is the page's largest paint; the rest ask for 800, which is
    more than any tile is ever drawn at.
  */
  const tiles = property.images.map((image, index) => ({
    id: image.fileKey,
    avif: imageUrl(image, index === 0 ? 1600 : 800, 'avif'),
    webp: imageUrl(image, index === 0 ? 1600 : 800, 'webp'),
    alt: localisedText(image.alt, locale) ?? '',
    width: image.width ?? (index === 0 ? 1600 : 800),
    height: image.height ?? (index === 0 ? 1000 : 600),
  }));

  return (
    <PropertyGallery
      images={slides}
      tiles={tiles}
      alt={name}
      labels={{
        title: t('slider.title'),
        open: t('slider.open'),
        previous: t('slider.previous'),
        next: t('slider.next'),
        close: t('slider.close'),
        zoomIn: t('slider.zoomIn'),
        zoomOut: t('slider.zoomOut'),
      }}
      viewAllLabel={t('slider.viewAll', { n: property.images.length })}
    />
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
