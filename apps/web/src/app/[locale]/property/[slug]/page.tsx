import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { confirmationWindowLabel } from '@/lib/operating-rules';

import { isLocale, routing, type Locale } from '@/i18n/routing';
import { MAX_BASKET_ROOMS } from '@/lib/basket-limits';
import { readableDate, readableMonth } from '@/lib/readable-date';
import { AmenityIcon } from '@/components/icons';
import { SaveButton } from '@/components/save-button';
import { ShareButton } from '@/components/share-button';
import { PropertyGallery } from '@/components/property-gallery';
import { BookingSelectionProvider } from '@/components/booking-selection';
import { CardSlider } from '@/components/card-slider';
import { BookingSummaryCard } from '@/components/booking-summary-card';
import { UnitSelector } from '@/components/unit-selector';
import {
  multiplyMoney,
  priceWithCustomerFee,
  subtractMoney,
  countedTexts,
} from '@/lib/customer-fee';
import { formatMoney, localisedName, localisedText } from '@/lib/localise';
import { getProperty, imageUrl, type PropertyDetail } from '@/lib/property';
import { dynamicMessage } from '@/lib/dynamic-message';
import { StarRating } from '@safra/ui';
import { DEFAULT_MONEY_CURRENCY, preferredCurrency } from '@safra/contracts';

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

  /*
    The reader's OWN dates reach the API, so each room says whether it can be booked for them.

    Read straight from the query rather than from `stay` below, which is built after this. Absent or
    malformed dates simply mean no availability claim is made — the API treats the stay as optional
    for exactly that reason.
  */
  const askedCheckIn = first(query['checkIn']);
  const askedCheckOut = first(query['checkOut']);
  const askedStay =
    askedCheckIn && askedCheckOut && askedCheckIn < askedCheckOut
      ? { checkIn: askedCheckIn, checkOut: askedCheckOut }
      : undefined;

  const property = await getProperty(slug, askedStay);
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
  /* The confirmation window as CONFIGURED — never «ساعتان» in the copy (finding 217). */
  const confirmationWindow = await confirmationWindowLabel();
  const ts = await getTranslations('starRating');
  const tc = await getTranslations('city');
  /* The stepper's «زيادة {field}» / «إنقاص {field}», shared with the search form's steppers. */
  const tstep = await getTranslations('search');

  const name = localisedText(property.name, locale);
  const description = localisedText(property.description, locale);
  const headline = localisedText(property.headline, locale);
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
  /**
   * The reviews the booking panel quotes.
   *
   * Every one with something to say rather than the first (Bashar, 2026-09-15: «add a slider here
   * same as booking.com»). It was `.find(...)` — one review, on the reasoning that a panel paging
   * through them would compete with the price beside it for attention. He has asked for the pager,
   * so that reasoning is retired.
   *
   * Capped at six. A rail a guest can reach the end of says «this is what people said»; one that
   * runs to forty says «keep scrolling», and the full set is a section down the page for anybody
   * who wants it. The 40-character floor is unchanged: «جيد» quoted in a panel is not a reason.
   */
  const quotable = (property.reviews ?? [])
    .filter((one) => (one.body ?? '').trim().length > 40)
    .slice(0, 6);

  const highlight = quotable[0];

  const cheapest = property.units[0];
  const defaultStay = firstAvailableWindow(property.calendar, cheapest?.minNights ?? 1);

  /*
    The visitor's chosen currency, and the rates that reach it. Both reads are cached for five
    minutes and deduplicated per request, so this costs nothing the page was not already paying.
  */

  /*
    The fee is IN the figure, as it is in every card (Bashar, 2026-09-03).

    `basePrice` is the partner's own rate and stays that in the payload; the fee is applied here,
    at the point of display, from the rule the same endpoint sends. A flat fee is per BOOKING, so a
    per-night «from» price carries the whole of it — which is exact for the one-night stay the
    figure is a floor for, and never understates a longer one.
  */
  const nightly = formatMoney(
    cheapest
      ? priceWithCustomerFee(cheapest.basePrice, cheapest.currencyCode, property.fees)
      : '0',
    cheapest?.currencyCode ?? DEFAULT_MONEY_CURRENCY,
    locale,
  );

  /*
    The rooms, prepared for a CLIENT component.

    Grouping, availability, pricing, plurals and amenity names are all resolved here, because the
    selector has to be a client component — choosing a room updates the card beside it — and a
    server component may not hand one a function. Every figure is computed once, so a row and the
    summary card can never disagree about what a stay costs.
  */
  const groups = new Map<string, PropertyDetail['units']>();

  for (const unit of property.units) {
    /*
      Null means one of a kind — a villa, a farm — so it groups with nothing.

      The price and the capacity are part of the KEY, not just the code, because they are part of
      the allocation's definition of interchangeable: booking N rooms prices them all at the chosen
      room's rate and multiplies its capacity, so it will only ever fill a quantity with rooms that
      match on both. Grouping on the code alone would let this page offer «6 rooms left» and cap the
      stepper at six, and checkout would then refuse at four — a control that appears to work and
      cannot complete.
    */
    const key =
      unit.roomTypeCode === null
        ? `unit:${unit.id}`
        : `${unit.roomTypeCode}|${unit.basePrice}|${unit.maxGuests}`;

    groups.set(key, [...(groups.get(key) ?? []), unit]);
  }

  const askedStayWindow = {
    checkIn: stay.get('checkIn') ?? defaultStay.checkIn,
    checkOut: stay.get('checkOut') ?? defaultStay.checkOut,
  };

  const askedNights = Math.max(
    1,
    Math.round(
      (Date.parse(`${askedStayWindow.checkOut}T00:00:00Z`) -
        Date.parse(`${askedStayWindow.checkIn}T00:00:00Z`)) /
        86_400_000,
    ),
  );

  /*
    ── ONE window for the whole page ─────────────────────────────────────────

    A booking has one arrival and one departure, so a basket mixing room types has to share them.
    The page used to extend the departure PER ROOM, which was right when a booking was one type and
    is incoherent for a basket: two lines would have claimed two different stays.

    Where the guest CHOSE dates, those dates are kept — honouring a search is not optional, and a
    room whose minimum is longer is shown with the shortfall stated rather than silently repriced
    for a stay nobody asked for.

    Where they chose NOTHING, the window stretches to cover the longest minimum on offer, so the
    default view of a hotel is one in which every room can actually be added. That is a default,
    not a surprise: there is no expectation to violate.
  */
  /*
    `has`, not `get() !== undefined`.

    `URLSearchParams.get` returns NULL for a missing key, so the first version read as «the guest
    chose dates» on every single request — and the default window never stretched to cover the
    hotel's longest minimum, which is the whole point of it. Silent, and it would have shipped.
  */
  const chose = stay.has('checkIn') && stay.has('checkOut');
  const longestMinimum = property.units.reduce(
    (most, one) => (one.available ? Math.max(most, one.minNights) : most),
    1,
  );
  const nights = chose ? askedNights : Math.max(askedNights, longestMinimum);
  const departure = new Date(`${askedStayWindow.checkIn}T00:00:00Z`);

  departure.setUTCDate(departure.getUTCDate() + nights);

  const stayWindow = {
    checkIn: askedStayWindow.checkIn,
    checkOut: departure.toISOString().slice(0, 10),
  };

  /*
    The largest capacity a basket here could reach: ten rooms of the roomiest type.

    Bounded on purpose, because these become an ARRAY of resolved sentences — a client component
    cannot be handed a formatter, and the alternative is shipping the ICU runtime to the browser
    for two counted words.
  */
  const largestCapacity =
    MAX_BASKET_ROOMS *
    property.units.reduce((most, one) => Math.max(most, one.maxGuests), 1);

  const rooms = [...groups.values()].map((group, index) => {
    /* The cheapest AVAILABLE room of the type; the API orders available first within a price. */
    const free = group.filter((one) => one.available);
    const unit = free[0] ?? group[0]!;

    /*
      Whether this type can be added to a basket for THIS window.

      Not «is it free» — that is `free.length` — but «will it accept a stay this short». A suite
      that takes two nights cannot join a one-night basket, and the row says the minimum and what
      to do about it rather than offering a control that checkout would refuse.
    */
    const tooShort = unit.minNights > nights;

    const shown = (amount: string) => formatMoney(amount, unit.currencyCode, locale);

    /* The room alone, the fee alone, and their sum — three figures that reconcile on screen. */
    const roomOnly = multiplyMoney(unit.basePrice, unit.currencyCode, nights);
    const withFee = priceWithCustomerFee(roomOnly, unit.currencyCode, property.fees);
    const feeOnly = subtractMoney(withFee, roomOnly, unit.currencyCode);

    return {
      unitId: unit.id,
      name: unit.name[locale as 'ar'] ?? unit.name.ar ?? '',
      cheapest: index === 0,
      soldOut: free.length === 0,
      /* What is FREE, not what exists — and silent when there is only ever one. */
      leftText: free.length > 1 ? t('unitsLeft', { count: free.length }) : null,
      occupancyText: `${t('guestsUpTo', { count: unit.maxGuests })} · ${t('unitLayout', {
        bedrooms: unit.bedrooms,
        beds: unit.beds,
        bathrooms: unit.bathrooms,
      })}`,
      termsText: `${t('unitAvailable')} · ${t('unitNightsMin', { count: unit.minNights })}${
        unit.maxNights === null
          ? ''
          : ` · ${t('unitNightsMax', { count: unit.maxNights })}`
      }`,
      policyText: policyName(property.cancellationPolicy, locale),
      /*
        Code AND name. The name is resolved here, where the catalogue and the reader's locale both
        are; the code travels with it so the chip can draw the right mark without a second lookup.
      */
      amenities: unit.amenityCodes.map((code) => ({
        code,
        name: dynamicMessage(ta, code, code),
      })),
      perNightText: shown(
        priceWithCustomerFee(unit.basePrice, unit.currencyCode, property.fees),
      ),
      /* How the headline total was reached — the nightly rate and the night count. */
      stayCaption: t('unitStayCaption', {
        rate: shown(unit.basePrice),
        nights,
      }),
      maxRooms: Math.max(1, free.length),
      /*
        The unit's OWN currency, unconverted — the basket sums the lines and converts once at the
        end. Converting here and adding the converted figures would round per line and produce a
        total that disagrees with the charge.
      */
      perRoomAmount: roomOnly,
      currencyCode: unit.currencyCode,
      tooShort,
      tooShortText: tooShort ? t('basketTooShort', { count: unit.minNights }) : null,
      roomLineLabel: t('summaryRoomLine', { nights }),
      roomLineAmount: shown(roomOnly),
      feeAmount: shown(feeOnly),
      totalText: shown(withFee),
      checkIn: stayWindow.checkIn,
      checkOut: stayWindow.checkOut,
      /*
        The same dates as words. «2026-10-05» in an Arabic booking summary is a machine's rendering
        of a date, and the card is the last thing a guest reads before committing — the one place
        the arrival should be a day of the week rather than a serial number.
      */
      checkInText: readableDate(stayWindow.checkIn, locale),
      checkOutText: readableDate(stayWindow.checkOut, locale),
      nights,
      nightsText: t('summaryNights', { count: nights }),
      maxGuests: unit.maxGuests,
      minNights: unit.minNights,
      capacityText: t('guestsUpTo', { count: unit.maxGuests }),
    };
  });

  return (
    /*
      One client boundary around BOTH the room list and the summary card.

      They sit in different columns of a server-rendered page, and a choice in one has to appear in
      the other at once. A provider spanning them is the only way to share that state — see
      `booking-selection.tsx`.
    */
    <BookingSelectionProvider
      propertySlug={property.slug}
      /* The stay the prices below were computed for — a basket belongs to one. */
      stay={{ checkIn: stayWindow.checkIn, checkOut: stayWindow.checkOut }}
      /* This render's types, so a restored basket carries THIS page's money. */
      available={rooms}
    >
      <article className="mx-auto max-w-7xl px-4 py-8">
        <nav aria-label={tnav('breadcrumb')} className="text-sm text-faint">
          {/* Both breadcrumb links are controls — see the note on the city page. */}
          <Link
            href={`/${locale}`}
            className="inline-flex min-h-10 items-center hover:text-gold-read lg:min-h-0"
          >
            {tc('backHome')}
          </Link>
          <span aria-hidden className="mx-2">
            ←
          </span>
          <Link
            href={`/${locale}/city/${property.city.slug}`}
            className="inline-flex min-h-10 items-center hover:text-gold-read lg:min-h-0"
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
              {/*
              ── Type, CLASSIFICATION, city, then the review score ──────────────

              The star row sits with the property TYPE and the review score keeps its own «★ 4.6 ·
              132 reviews» further along, exactly as on the card. This is the one screen where both
              facts are guaranteed to appear together, so the separation matters most here: a row
              of five shapes is a classification, a glyph with a decimal beside a count is an
              average of opinions, and a reader never has to be told which is which.

              It became a flex row of spans rather than a concatenated string because a component
              cannot be interpolated into one — and `items-center` so the stars sit on the text's
              centre line rather than its baseline.
            */}
              {/*
              ── The classification on its OWN line, under the name ─────────────

              It was inline in the meta line, between the type and the city, which is where the
              CARD puts it — and on a card that line is «فندق ★★★☆☆ · حلب» and reads cleanly. Here
              the same line carries five facts («فندق · حلب · ★ 5.0 · تقييم واحد · PRO-002503»),
              and a screenshot showed the stars landing in the middle of that sentence next to the
              review score's "★ 5.0". Both were legible; neither was PROMINENT.

              Bashar's requirement is «the user should immediately see its star rating», so on the
              one screen with room for it, it gets its own line directly under the name — which is
              also where booking.com puts it, and which puts a whole line between it and the review
              score it must not be confused with. The component is the same; only the placement
              differs, and the placement is what the space allows.
            */}
              {property.starRating ? (
                <p className="mt-2">
                  <StarRating
                    value={property.starRating}
                    size="md"
                    label={ts('stars', { count: property.starRating })}
                  />
                </p>
              ) : null}

              <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted">
                <span>
                  {dynamicMessage(
                    tt,
                    property.propertyTypeCode,
                    property.propertyTypeCode,
                  )}
                </span>
                <span>
                  · {cityName}
                  {property.rating ? ` · ★ ${property.rating}` : ''}
                  {property.reviewsCount > 0
                    ? ` · ${t('reviews', { count: property.reviewsCount })}`
                    : ''}
                  {' · '}
                  <span className="text-faint">{property.reference}</span>
                </span>
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
                  className="inline-flex min-h-10 items-center font-semibold text-gold-read underline decoration-gold/40 underline-offset-2 lg:min-h-0 hover:decoration-gold"
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
                  className="rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-xs text-gold-read"
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
                {/*
                  NO heading (Bashar, 2026-09-15: «remove عن هذا العقار from the single hotel
                  page»). It carried one for two days, added on 2026-09-13 because this was the one
                  section that announced nothing while «مرافق العقار», «سياسة الإلغاء», «الموقع»,
                  «تقييمات الضيوف» and «اختر وحدتك» all did.

                  The partner's own line leads instead, above their paragraph — booking.com's
                  «اشعر وكأنك نجم…». Most listings have none, so the common case is a bare
                  paragraph; neither element carries a top margin, because the section's own
                  `space-y-8` already separates it from the gallery and a margin here would open a
                  gap above whichever of the two happens to be first.
                */}
                {headline ? <p className="font-semibold text-text">{headline}</p> : null}
                <p className={`whitespace-pre-line text-muted${headline ? ' mt-3' : ''}`}>
                  {description}
                </p>
              </section>
            ) : null}

            {/* ── The rooms, and the choice between them ────────────────────── */}
            <UnitSelector
              rooms={rooms}
              copy={{
                title: t('unitsTitle'),
                note: t('unitsNote'),
                one: t('unitsOne'),
                book: t('basketAdd'),
                /* Resolved for every reachable count — a client component takes no formatter. */
                inBasketTexts: countedTexts((count) => t('basketInBasket', { count })),
                cheapest: t('unitCheapest'),
                soldOut: t('unitSoldOut'),
                amenitiesLabel: t('unitAmenitiesLabel'),
                stayTotalLabel: t('unitStayTotalLabel'),
                amenitiesNone: t('unitAmenitiesNone'),
                cancellation: t('cancellationPolicy'),
              }}
            />

            {/* ── What the BUILDING offers, as opposed to a room (Bashar, 2026-09-06) ── */}
            {property.amenityCodes.length > 0 ? (
              <section>
                <h2 className="font-display text-xl text-text">
                  {t('propertyAmenities')}
                </h2>
                <p className="mt-1 text-sm text-muted">{t('propertyAmenitiesNote')}</p>
                {/*
                Bordered cells, as booking.com draws them — scannable in a way a bulleted list is
                not, and this is a list people scan for one word.

                **One drawing per amenity** (Bashar, 2026-09-11). This note used to say there were
                no icons on purpose: the catalogue's `icon` column is populated for 0 of 12 rows, so
                the choice was twelve identical marks or none, and twelve identical ticks is
                decoration pretending to be information. That reasoning argued for drawing them
                rather than for going without, and `AmenityIcon` is keyed by CODE — so a pool gets
                a pool and an amenity added tomorrow gets a mark that claims nothing until somebody
                draws it, instead of a blank where a typo'd icon name used to be.

                `aria-hidden`, because the name is right beside it and a screen reader announcing
                both says «مسبح مسبح».

                This list used to be the CHEAPEST UNIT's amenities under the heading «المرافق»,
                which told a guest the building had whatever the smallest room happened to have.
              */}
                <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {property.amenityCodes.map((code) => (
                    <li
                      key={code}
                      className="flex items-center gap-2.5 rounded-lg border border-line bg-card px-3 py-2.5 text-sm text-text"
                    >
                      {/* `text-xl` against a `1.15em` glyph — see the room list for why the size
                          sits on the span rather than in `ICON`. */}
                      <span aria-hidden className="shrink-0 text-xl text-gold-read">
                        <AmenityIcon code={code} />
                      </span>
                      <span className="min-w-0">{dynamicMessage(ta, code, code)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* ── Cancellation policy (§7.4) ────────────────────────────────── */}
            <section>
              <h2 className="font-display text-xl text-text">
                {t('cancellationPolicy')}
              </h2>
              <div className="mt-3 rounded-card border border-line bg-card p-5">
                <p className="font-semibold text-text">
                  {policyName(property.cancellationPolicy, locale)}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {policyDescription(property.cancellationPolicy, locale)}
                </p>
                <p className="mt-3 text-sm text-muted">
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
                <p className="mt-2 text-xs text-faint">
                  {t('exactLocationAfterBooking')}
                </p>
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

                  {/*
                    A RAIL, as the booking panel's quotes are (Bashar, 2026-09-15: «do the same
                    slider on the reviews section below»). It was a column of cards, so ten reviews
                    pushed the cancellation policy, the location and everything under them a screen
                    and a half down the page.

                    ## The arrows moved to the SIDES, and the padding is what lets them

                    Bashar asked for booking.com's own guest-review rail by screenshot
                    (2026-09-15): bigger cards, and the pair of circles resting on the rail's two
                    edges rather than sitting under it. The earlier note here said a floating arrow
                    covers the prose it pages — it did, on a `p-5` card with the button at the
                    edge, and the fix is geometric rather than a retreat. `side` shifts each button
                    16px OUT, so a 40px circle reaches 24px in; `p-6` starts the words at 24px. The
                    two numbers are one decision — read `arrows` in `card-slider.tsx`, which
                    records what each edge was measured to do, before changing either.

                    ## Bigger, and shaped like something somebody said

                    `sm:w-[23rem]` and `p-6`, against `sm:w-80` and `p-5`. The card now opens with
                    the guest — their name and the month they stayed — carries the quote
                    at the body size rather than the metadata size, and closes on the one fact that
                    makes a review worth anything: it came from a stay that actually happened. That
                    line sits at the FOOT of every card on an `mt-auto`, so it lands in the same
                    place whether the quote is two lines or ten.

                    `w-[86%]` on a phone rather than a full width: the sliver of the next card is
                    what says the rail moves, and it is the only such cue a thumb gets.
                  */}
                  <div className="mt-4">
                    <CardSlider
                      bleed={false}
                      arrowsOnPhone
                      arrows="side"
                      labels={{
                        previous: t('reviewPrevious'),
                        next: t('reviewNext'),
                      }}
                    >
                      {property.reviews.map((review) => (
                        <li
                          key={review.reference}
                          className="flex w-[86%] shrink-0 snap-start flex-col rounded-card border border-line bg-card p-6 sm:w-[23rem]"
                        >
                          {/*
                              No monogram disc beside the name (Bashar, 2026-09-16: «remove the
                              circle beside the name»). It was a tinted initial standing in for the
                              photograph the API does not send — the name and the month carry the
                              guest on their own, and one less painted shape leaves the quote as
                              the loudest thing on the card.
                            */}
                          <div className="flex items-center gap-3">
                            <div className="min-w-0">
                              {review.author ? (
                                <p className="truncate text-[15px] font-bold text-text">
                                  {review.author}
                                </p>
                              ) : null}
                              {/*
                                  The month and the year, never the weekday: «الأحد» belongs to a
                                  date somebody has to keep, and what a reader weighs on a review
                                  is how long ago it was.
                                */}
                              <p className="mt-0.5 text-xs text-faint">
                                {readableMonth(review.createdAt.slice(0, 10), locale)}
                              </p>
                            </div>

                            {/*
                                `dir="ltr"`: a ★ followed by a digit is a Latin run, and the star is
                                bidi-neutral — without this it lands on the wrong side of the
                                number. It is the card's answer, so it is bold and 14px, never the
                                faintest thing on it.
                              */}
                            <span
                              dir="ltr"
                              className="ms-auto shrink-0 rounded-lg bg-gold/10 px-2.5 py-1 text-sm font-bold text-gold-read"
                            >
                              <span aria-hidden>★</span> {review.rating}
                            </span>
                          </div>

                          {/*
                              `dir="auto"` because a review is written in the GUEST's language and
                              read on a page in the READER's. An Arabic quotation inside an
                              `ltr` paragraph put the opening mark on the left and the closing one
                              on the right — measured on `/en`, where every seeded review is
                              Arabic. `auto` takes the direction from the text's own first strong
                              character, so the marks land where that language puts them and the
                              block aligns to the side it is meant to be read from.
                            */}
                          <p dir="auto" className="mt-4 text-[15px] leading-7 text-text">
                            “{review.body}”
                          </p>

                          {review.partnerReply ? (
                            /*
                                A hairline and an indent, not a tinted box. A card inside a card is
                                two objects where the page means «and the host answered» — the rule
                                is a 1px start border, so the reply reads as quoted rather than as
                                a second card sitting in the first.
                              */
                            <div className="mt-4 border-s border-gold/50 ps-3">
                              <p className="text-xs font-bold text-gold-read">
                                {t('reviewsPartnerReply')}
                              </p>
                              <p
                                dir="auto"
                                className="mt-1 text-sm leading-relaxed text-muted"
                              >
                                {review.partnerReply}
                              </p>
                            </div>
                          ) : null}

                          <p className="mt-auto flex items-center gap-1.5 pt-5 text-xs text-faint">
                            <svg
                              aria-hidden
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2.2}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="shrink-0 text-gold-read"
                            >
                              <path d="m4.5 12.5 5 5 10-11" />
                            </svg>
                            {t('reviewsVerified')}
                          </p>
                        </li>
                      ))}
                    </CardSlider>
                  </div>
                </>
              )}
            </section>
          </div>

          {/* ── Booking panel ─────────────────────────────────────────────────── */}
          {/*
          `scroll-mt` so the sticky header does not land on top of the panel the anchor just jumped
          to — the same reason every row on the console carries one.

          **It does NOT follow the scroll** (Bashar, 2026-09-13: «unfix the left carts position»).
          It used to be `lg:sticky lg:top-24`, so the rating and the price rode down the page beside
          the room list and the reviews. `lg:self-start` stays: without it the panel is a stretched
          grid item and its cards sit in the middle of a column as tall as the whole page.
        */}
          <aside id="booking" className="scroll-mt-28 lg:self-start">
            {/*
            The score, the count, and one thing a guest actually said — booking.com's card, and the
            reason it sits ABOVE the price is that it answers the question the price provokes. A
            rating with no sentence under it is a number; a sentence with a name under it is a
            reason.
            
            A SLIDER since 2026-09-15, as booking.com has (Bashar). It used to be one review, on
            the reasoning that paging would compete with the price beside it for attention; that is
            his call rather than mine, and the rail is bounded at six to keep it a sample rather
            than the whole section.

            `CardSlider` is the site's one slider, the same component the home page's destinations
            use — not a second one written for this panel. What it needed was two knobs: no bleed,
            because there is no page padding to cancel inside a card, and arrows on a phone,
            because a one-item rail shows no neighbour peeking to say it moves.

            The arrows FLANK the quote (Bashar, 2026-09-16: «move the buttons to the left and right
            beside the feedback»). They were a pair under it, which read as a footer to the review
            rather than as a way through it.
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
                  <div className="mt-4 border-t border-line pt-4">
                    <p className="text-xs font-semibold text-muted">{t('guestsLoved')}</p>

                    {/*
                      One review is a figure, several are a rail. Rendering the slider for a single
                      quote would draw a control with nowhere to go — the shape this review keeps
                      finding — so the rail appears only when there is a second review to reach.
                    */}
                    {quotable.length > 1 ? (
                      /*
                        Quote, then the pager, then the name (Bashar, 2026-09-16).

                        The arrows are back UNDER the rail and the quote is full width again. They
                        flanked it for a day; in a 320px panel that cost the text 48px of its 278,
                        and his word for the result was that it put the comment in the centre.
                      */
                      <div className="mt-2">
                        <CardSlider
                          bleed={false}
                          arrowsOnPhone
                          arrows="below"
                          labels={{
                            previous: t('reviewPrevious'),
                            next: t('reviewNext'),
                          }}
                          footers={quotable.map((review) =>
                            review.author ? (
                              <QuoteAuthor
                                key={review.reference}
                                as="p"
                                author={review.author}
                                className="mt-1"
                              />
                            ) : null,
                          )}
                        >
                          {quotable.map((review) => (
                            <li
                              key={review.reference}
                              /*
                                `w-full shrink-0`, so each review is exactly one rail-width and the
                                arrows page one review at a time. `snap-start` parks it flush.
                              */
                              className="w-full shrink-0 snap-start"
                            >
                              <QuoteBody body={review.body} />
                            </li>
                          ))}
                        </CardSlider>
                      </div>
                    ) : (
                      <div className="mt-2">
                        <Quote body={highlight.body} author={highlight.author} />
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-card border border-gold/30 bg-card p-5">
              {cheapest ? (
                <>
                  {/*
                  The card is LIVE now: it answers "what am I about to book, and what does it cost"
                  from the guest's own choice, and its button names which of the two states it is in
                  — «اختر غرفة» while nothing is chosen, «احجز الآن» once something is.

                  It used to show the cheapest room's «from» price above a button that booked that
                  room, so a guest reading «من ٧٣٫٩٩» on a thirteen-room hotel and pressing it
                  silently bought the smallest one. The figure and the action disagreed.
                */}
                  <BookingSummaryCard
                    locale={locale}
                    propertySlug={property.slug}
                    guests={{ adults, children, infants }}
                    /*
                      The cheapest ROOM's stay total, taken from the same view model the list
                      renders — not computed again here. Two derivations of one figure is how a
                      card and the row it summarises come to disagree.
                    */
                    fromPrice={rooms[0]?.totalText ?? nightly}
                    stay={{
                      checkIn: stayWindow.checkIn,
                      checkOut: stayWindow.checkOut,
                      checkInText: readableDate(stayWindow.checkIn, locale),
                      checkOutText: readableDate(stayWindow.checkOut, locale),
                    }}
                    /*
                      The rule and the rate table, as plain DATA.

                      The basket adds its lines up and works the fee out on the sum, so it needs the
                      fee RULE rather than a computed amount — and the rates, so it can convert the
                      answer once at the end. All serialisable, which is what lets a server
                      component hand it to a client one.
                    */
                    money={{
                      /*
                        `preferredCurrency`, never a typed code.
                        
                        A hardcoded «USD» is what `one-fee-rule.test.ts` sweeps for and it caught
                        this one: a listing with no rooms would have priced in whatever code got
                        typed here rather than in the platform's own default.
                      */
                      currencyCode: preferredCurrency(
                        rooms.map((room) => room.currencyCode),
                      ),
                      fees: property.fees,
                    }}
                    copy={{
                      fromLabel: t('summaryFromLabel'),
                      fromCaption: rooms[0]?.stayCaption ?? '',
                      chooseRoom: t('chooseRoom'),
                      bookNow: t('bookNow'),
                      selected: t('basketSelected'),
                      remove: t('basketRemoveLine'),
                      clear: t('basketClear'),
                      roomsLabel: t('summaryRooms'),
                      /*
                        The same two templates the search form's steppers use, not a second pair.
                        It is one control with one pair of words; a copy per screen is how four
                        galleries came to behave four different ways.
                      */
                      increase: tstep('increase'),
                      decrease: tstep('decrease'),
                      fee: t('summaryFee'),
                      /* One per reachable basket size — a client component takes no formatter. */
                      feeTimes: countedTexts((count) => t('summaryFeeTimes', { count })),
                      total: t('summaryTotal'),
                      policy: t('summaryPolicy'),
                      amenities: t('summaryAmenities'),
                      empty: t('basketEmpty'),
                      accommodation: t('basketAccommodation'),
                      nightsText: t('summaryNights', { count: nights }),
                      guestsText: t('summaryGuests', { count: adults + children }),
                      /*
                        Two ICU plurals the basket needs for numbers only IT knows — the capacity of
                        a line, and of the whole basket. Passed as resolvers rather than strings
                        because the count is not known until a guest has chosen; they are still
                        catalogue messages, resolved on the server, so no formatter crosses the
                        boundary and no sentence is assembled in a component.
                      */
                      capacityTexts: countedTexts(
                        (count) => t('basketCapacity', { count }),
                        largestCapacity,
                      ),
                      roomsCountTexts: countedTexts((count) =>
                        t('unitsCount', { count }),
                      ),
                      full: t('basketFull'),
                      lineAll: t('basketLineAll'),
                    }}
                  />

                  {/*
                  "Ask SAFRA", never "contact the property". §5.6 and P-001 forbid exposing partner
                  contact details before confirmation.
                */}
                  <Link
                    href={`/${locale}/account/support`}
                    className="mt-2 block rounded-lg border border-line px-5 py-3 text-center text-sm text-muted transition-colors hover:border-gold hover:text-gold-read"
                  >
                    {t('askSafra')}
                  </Link>

                  <p className="mt-4 text-xs text-faint">
                    {t('notInstantNotice', { window: confirmationWindow })}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted">{t('noUnits')}</p>
              )}
            </div>
          </aside>
        </div>
      </article>
    </BookingSelectionProvider>
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
      className="shrink-0 text-gold-read"
    >
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

/**
 * One quoted review, as the booking panel prints it.
 *
 * Extracted when the panel gained a slider (2026-09-15): the same markup renders once on a listing
 * with a single quotable review and once per slide on one with several, and two copies of it would
 * be two places for the clamp and the quotation marks to drift apart.
 *
 * A real quotation mark pair, not the ASCII kind, and the body is clamped to three lines: a panel
 * quote is a snippet somebody reads at a glance, and the whole review is one section down for
 * anybody who wants it.
 *
 * No `min-h`: the slides are flex items and a flex row already stretches them to the tallest, so
 * the rail's height is the longest quote's whatever the others hold. A floor on the blockquote was
 * tried and only padded the SHORT ones, opening a band of empty card between a two-line review and
 * the arrows under it — measured, then removed.
 */
function Quote({
  body,
  author,
}: {
  readonly body: string;
  readonly author: string | null;
}) {
  return (
    <figure>
      <QuoteBody body={body} />
      {author ? <QuoteAuthor as="figcaption" author={author} className="mt-2" /> : null}
    </figure>
  );
}

/**
 * The quotation itself, separated from its attribution.
 *
 * The rail needs the two apart, because the arrows now sit BETWEEN them (Bashar, 2026-09-16), and
 * an arrow row cannot be threaded through the middle of a slide. So the slides carry this, and the
 * name travels as the slider's `footers` — one `<figure>` around the whole rail keeps them a
 * quotation and its attribution rather than two lines that happen to be near each other.
 *
 * `dir="auto"` for the reason the section's cards carry it: the quotation marks belong to the
 * reviewer's language, not the page's.
 */
function QuoteBody({ body }: { readonly body: string }) {
  return (
    <blockquote dir="auto" className="line-clamp-3 text-sm leading-relaxed text-text">
      “{body}”
    </blockquote>
  );
}

/**
 * Who said it — written once, so the single-quote card and the rail's footer cannot drift.
 *
 * The ELEMENT differs because the association does. On a listing with one quotable review the name
 * is a `<figcaption>` inside `Quote`'s own figure, which is how a screen reader is told that this
 * name belongs to those words. In the rail it cannot be: the slider owns the markup between the
 * quotation and the footer, so a `figcaption` there would be a grandchild of the figure rather
 * than its child — invalid, and unassociated by exactly the machinery it was reached for. A
 * paragraph directly under the quotation is the honest fallback, and `as` makes the choice visible
 * at the call site instead of hiding a wrong element inside a shared component.
 */
function QuoteAuthor({
  author,
  as: Tag,
  className = '',
}: {
  readonly author: string;
  readonly as: 'figcaption' | 'p';
  readonly className?: string;
}) {
  return <Tag className={`text-xs text-faint ${className}`}>{author}</Tag>;
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
