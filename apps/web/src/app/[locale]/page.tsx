import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { SearchForm } from '@/components/search-form';
import { OrnamentField } from '@/components/ornament';
import { CardSlider } from '@/components/card-slider';
import { PropertyCard } from '@/components/property-card';
import {
  CompensationIcon,
  STAY_TYPE_ICONS,
  StayIcon,
  VerifiedIcon,
  WalletIcon,
} from '@/components/icons';
import { isLocale, type Locale } from '@/i18n/routing';
import {
  getCities,
  getPropertyTypes,
  getPublicSettings,
  type City,
  type PropertyType,
} from '@/lib/catalog';
import { searchSafely } from '@/lib/api';
import { formatCustomerFee, todayInDamascus } from '@/lib/settings';
import { localisedName, localisedText } from '@/lib/localise';
import { imageUrl } from '@/lib/property';
import { dynamicMessage } from '@/lib/dynamic-message';
import { ORNAMENT_BRAND, ORNAMENT_CRESCENT, ORNAMENT_STAR } from '@safra/ui';

export const revalidate = 300;

/**
 * The trip features offered under the search bar, in the prototype's order.
 *
 * The CODES are the search contract's (`attributes` on `/search`), and the words come from the
 * `attributes` block in `@safra/i18n`, which already carries all ten in three languages. Written
 * here rather than read from an endpoint because there is no attributes endpoint: these are a
 * fixed vocabulary in the search service, not a table staff manage, and inventing a read for them
 * would be a round trip on the home page's critical path to fetch a constant.
 */
const TRIP_FEATURES = [
  'sea',
  'mountain',
  'history',
  'nature',
  'families',
  'honeymoon',
  'pool',
  'parking',
  'internet',
  'business',
] as const;

/**
 * The home page — the approved prototype's composition, built with the product's own tokens.
 *
 * ## Where this comes from
 *
 * `SAFRA - موقع سفرة 20.08.html` is the approved design and this page follows its SECTIONS and its
 * copy: a centred hero over a radial glow, the search bar with the trip features under it, then
 * destinations, stay types, «موصى به من سفرة», the four booking steps, the three pledges, and the
 * partner band. Two earlier attempts invented compositions of their own instead of reading it; the
 * prototype is the brief and this follows it.
 *
 * What is taken from booking.com is the DISCIPLINE rather than the shape: one card pattern used
 * everywhere, a tight and even section rhythm, counts and prices stated plainly on the card, one
 * action colour, and nothing on the page that is not either information or a way in.
 *
 * ## Light mode has no dark surfaces (Bashar, 2026-09-02)
 *
 * Every colour on this page is a token — `bg-bg`, `bg-card`, `bg-band`, `border-line`, `text-gold`
 * — and never a literal. That is the whole mechanism: in the light theme those resolve to a white
 * card on a pale page, and in the dark theme they resolve to the prototype's night, including the
 * hero's glow, which is a gradient between `--color-hero`, `--color-band` and `--color-bg` rather
 * than between three fixed indigos. One page, and the theme decides whether it is night.
 *
 * ## Motion
 *
 * Hover, focus and press only, in CSS, on one curve. Nothing enters on scroll: this is the surface
 * a returning visitor meets on every visit, and an entrance animation there reads as latency.
 */
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('home');
  const tt = await getTranslations('propertyTypes');
  const ta = await getTranslations('attributes');

  const today = todayInDamascus();
  const tomorrow = tomorrowInDamascus();

  /*
    Four independent reads, none of which depends on another, so none of them waits.

    The search is the only new one and it is the CACHED reader — the same one the city page's
    teaser uses, for the same reason and with the same explicit trade-off: it is marketing content,
    a visitor's next step queries live availability, and the booking endpoint re-validates against
    the exclusion constraint regardless. `searchSafely` never throws, so a search that fails or a
    same-day cutoff that has passed leaves the section absent rather than the page broken.
  */
  const [cities, propertyTypes, settings, recommended] = await Promise.all([
    getCities(),
    getPropertyTypes(),
    getPublicSettings(),
    recommendedStays(today, tomorrow),
  ]);

  const serviceFee = formatCustomerFee(settings, 'customerFee', locale);

  const trust = [
    { icon: VerifiedIcon, label: t('trustVerified') },
    { icon: WalletIcon, label: t('trustPayment') },
    { icon: CompensationIcon, label: t('trustCompensation') },
  ];

  const steps = [
    { title: t('step1Title'), body: t('step1Body') },
    /* The fee is a setting the super admin edits (P-005), never a literal in the copy. */
    { title: t('step2Title'), body: t('step2Body', { fee: serviceFee }) },
    { title: t('step3Title'), body: t('step3Body') },
    { title: t('step4Title'), body: t('step4Body') },
  ];

  const pledges = [
    {
      ornament: ORNAMENT_CRESCENT,
      ordinal: t('pledgeOrdinal1'),
      title: t('pledge1Title'),
      body: t('pledge1Body'),
    },
    {
      ornament: ORNAMENT_STAR,
      ordinal: t('pledgeOrdinal2'),
      title: t('pledge2Title'),
      body: t('pledge2Body'),
    },
    {
      ornament: ORNAMENT_BRAND,
      ordinal: t('pledgeOrdinal3'),
      title: t('pledge3Title'),
      body: t('pledge3Body'),
    },
  ];

  const stay = `?checkIn=${today}&checkOut=${tomorrow}&adults=2`;

  return (
    <>
      {/* ── Hero (§5.1) ──────────────────────────────────────────────────── */}
      {/*
        The prototype's glow, written in tokens rather than in the three indigos it names.

        `radial-gradient(1200px 600px at 50% -80px, …)` is the file's own declaration; substituting
        `--color-hero` / `--color-band` / `--color-bg` for its literals reproduces it exactly in the
        dark theme and turns it into a pale blue wash in the light one. A hard-coded `#241b52` would
        have been a dark band in light mode, which is the thing this page must not have.
      */}
      <section className="border-b border-line bg-[radial-gradient(1200px_600px_at_50%_-80px,var(--color-hero),var(--color-band)_45%,var(--color-bg))]">
        <div className="mx-auto max-w-5xl px-4 pt-8 pb-10 text-center sm:pt-14 sm:pb-12">
          <p className="inline-flex items-center rounded-full border border-gold/40 px-3 py-1 text-[0.6875rem] font-semibold tracking-wide text-gold">
            {t('heroCountries')}
          </p>

          {/*
            58px is the prototype's size; `clamp` gets there continuously rather than stepping at
            two breakpoints, and holds the Arabic headline on one line from about 900px up.
          */}
          <h1 className="mt-4 font-display text-[clamp(1.5rem,3.1vw,2.5rem)] leading-[1.22] font-bold text-balance text-gold">
            {t('heroTitle')}
          </h1>

          <p className="mx-auto mt-3 max-w-[62ch] text-sm leading-relaxed text-muted sm:text-base">
            {t('heroSubtitle')} {t('heroPromise')}
          </p>

          <div className="mt-6 text-start">
            <SearchForm locale={locale} cities={cities} minDate={today} />
          </div>

          {/*
            The trip features, exactly the ten the prototype puts under the bar.

            They are LINKS into `/search`, not decoration and not a client-side filter: this page
            ships no JavaScript, and a chip that looked interactive and did nothing would be worse
            than none. `?attributes=sea` is the shape the search page already parses — `many()`
            turns a single value into an array — so each one lands on a real filtered result set.

            `min-h-10` below `lg`, `lg:min-h-8` above. An anchor is INLINE, so the 40px touch floor
            in `globals.css` — which covers `button`, `select` and `summary` — cannot reach these;
            at 32px all ten failed `responsive.spec.ts` in all three languages. Above `lg` the input
            is a pointer and the compact chip is the right size.
          */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
            <span className="text-[0.6875rem] text-faint">{t('attributesLabel')}</span>
            {TRIP_FEATURES.map((code) => (
              <Link
                key={code}
                href={`/${locale}/search${stay}&attributes=${code}`}
                className="inline-flex min-h-10 items-center rounded-full border border-line bg-card px-2.5 py-1 text-[0.6875rem] text-muted lg:min-h-8 transition-[color,border-color,scale] duration-200 ease-out-strong hover:border-gold/60 hover:text-gold active:scale-[.97]"
              >
                {ta(code)}
              </Link>
            ))}
          </div>

          {/*
            The three promises, as the prototype sets them: one line, marked with the brand's own
            star, centred under the bar. They were a boxed grid in an earlier attempt, which made
            one statement in three parts read as three separate offers.
          */}
          <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {trust.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="flex items-center gap-2 text-[0.8125rem] text-muted"
              >
                <span aria-hidden className="shrink-0 text-gold">
                  <Icon />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Destinations (§5.4) ──────────────────────────────────────────── */}
      <section aria-label={t('destinationsTitle')} className="bg-bg">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:py-12">
          <SectionHeading eyebrow={t('destinationsTitle')}>
            {t('destinationsSubtitle')}
          </SectionHeading>

          {/*
            A SLIDER, the way booking.com moves through its destination rows (Bashar, 2026-09-02).

            It was a five-across grid, which is the prototype's arrangement and is right for nine
            cities and wrong for the tenth: a grid has to be re-chosen every time staff open a
            market, and a row of nine in five columns leaves four in the second row looking like an
            afterthought. A slider takes any number, shows the same card at every width, and the
            cut card at the edge is what says there is more — which no grid can say.

            The arrows live in `CardSlider`, the one client component on this page. Without
            JavaScript the row is still a scrollable rail, which is exactly what it was before.

            THREE across at `lg`, not four (Bashar, 2026-09-02). The width is chosen against the
            container rather than picked by eye: the rail is 1152px inside `max-w-6xl` less its
            own 16px of padding either side, so 3 × 21rem + 2 × 1rem gap = 1040 of 1120 — three
            whole cards and 80px of the fourth. That peek is deliberate and is the only thing on a
            horizontal row that says there is more; a width that divided exactly would end the row
            flush with the container edge and read as «there are three destinations».
          */}
          <div className="mt-5">
            <CardSlider labels={{ previous: t('sliderPrevious'), next: t('sliderNext') }}>
              {cities.map((city) => (
                <li
                  key={city.slug}
                  className="w-[13rem] shrink-0 snap-start sm:w-[16rem] lg:w-[21rem]"
                >
                  <CityCard city={city} locale={locale} stays={t} />
                </li>
              ))}
            </CardSlider>
          </div>
        </div>
      </section>

      {/* ── Types of stay (§8.2) ─────────────────────────────────────────── */}
      <section aria-label={t('typesTitle')} className="border-y border-line bg-card">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:py-12">
          <SectionHeading eyebrow={t('typesTitle')}>{t('typesSubtitle')}</SectionHeading>

          <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {propertyTypes.map((type) => (
              <li key={type.code}>
                <StayTypeCard
                  type={type}
                  locale={locale}
                  stay={stay}
                  label={dynamicMessage(tt, type.code, type.code)}
                  options={t}
                />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Recommended by SAFRA ─────────────────────────────────────────── */}
      {/*
        Absent rather than empty. The section exists to show three real stays; a heading over
        nothing says the site is broken, and this read can legitimately come back with nothing —
        a city's 17:00 cutoff has passed (§5.3), or the API blipped, both of which `searchSafely`
        turns into an empty list rather than an exception.
      */}
      {recommended.outcome.items.length > 0 ? (
        <section aria-label={t('recommendedTitle')} className="bg-bg">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:py-12">
            <SectionHeading eyebrow={t('recommendedTitle')}>
              {t('recommendedSubtitle')}
            </SectionHeading>

            {/*
              `PropertyCard` unchanged — the same card the search results use. A second card for
              the same object is how two surfaces come to disagree about a price, and this one
              already converts to the reader's currency, prints the original underneath when it
              did, names the service fee, and renders the two SAFRA badges the prototype shows.
            */}
            {/*
              The same `CardSlider` the destinations use (Bashar, 2026-09-02), so the two rows on
              this page behave identically — one arrow control, one keyboard story, one set of
              rules about when an arrow disappears. A second carousel written separately is how
              two rows on one page come to scroll by different amounts.

              `items-stretch` and `h-full` on the card, because a `PropertyCard` is a flex column
              that sizes to its content: in a grid the row equalised them, and in a flex rail
              nothing does, so the shortest card was 40px shorter than its neighbours.
            */}
            <div className="mt-5">
              <CardSlider
                labels={{
                  previous: t('recommendedPrevious'),
                  next: t('recommendedNext'),
                }}
              >
                {recommended.outcome.items.map((item) => (
                  <li
                    key={item.propertyReference}
                    className="flex w-[16rem] shrink-0 snap-start sm:w-[19rem] lg:w-[21rem]"
                  >
                    {/*
                      The card's own nights, not the page's. Where the cutoff pushed this row to
                      tomorrow, a link carrying TODAY would open the property page on a night that
                      is already closed — a card advertising a price and then refusing it.
                    */}
                    <PropertyCard item={item} locale={locale} stay={recommended.stay} />
                  </li>
                ))}
              </CardSlider>
            </div>
          </div>
        </section>
      ) : null}

      {/* ── How booking works (§6.1) ─────────────────────────────────────── */}
      <section aria-label={t('howTitle')} className="border-y border-line bg-card">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:py-12">
          <SectionHeading eyebrow={t('howTitle')}>{t('howSubtitle')}</SectionHeading>
          <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-muted">
            {t('howBody')}
          </p>

          {/*
            Four steps, numbered, because the ORDER is the point: the money moves first, the
            partner answers second, and the outcome is either a confirmation or all of it back.
            That sequence is the answer to «why is this not instant», which is the question the
            heading above raises.

            Western digits, unlike the prototype's ١٢٣٤. The rest of this page prints «٢٬٠١٠» as
            `2,010` — `globals.css` pins lining Western numerals for Arabic — and two numeral
            systems on one screen is harder to read than either.
          */}
          <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <li
                key={step.title}
                className="rounded-card border border-line bg-bg p-4 transition-colors duration-200 ease-out-strong hover:border-gold/45"
              >
                {/*
                  The numeral on the gold GRADIENT rather than in gold text. `--color-gold` on the
                  light card is 3.55:1, which a 13px numeral does not clear; `.btn-gold` carries its
                  own dark foreground and measures 6.1:1, and it ties the step markers to the page's
                  primary action — which is what the prototype's gold discs do.
                */}
                <span
                  aria-hidden
                  className="btn-gold inline-flex size-7 items-center justify-center rounded-full text-[0.8125rem] font-bold"
                >
                  {index + 1}
                </span>
                <h3 className="mt-2.5 text-[0.9375rem] font-semibold text-text">
                  {step.title}
                </h3>
                <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── The three pledges (P-001, P-002, P-007) ──────────────────────── */}
      <section aria-label={t('pledgesTitle')} className="bg-band">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:py-14">
          <SectionHeading eyebrow={t('pledgesTitle')} centred>
            {t('pledgesSubtitle')}
          </SectionHeading>

          <ul className="mt-7 grid gap-3 md:grid-cols-3">
            {pledges.map((pledge) => (
              <li
                key={pledge.title}
                className="rounded-card border border-line bg-card p-5 text-center"
              >
                {/*
                  The ornaments are the brand's own glyphs, not icons standing in for a set — the
                  prototype marks the three pledges with exactly these three, and `docs/i18n.md`
                  records why they are constants in `@safra/ui` rather than copy.
                */}
                <span
                  aria-hidden
                  className="inline-flex size-10 items-center justify-center rounded-full border border-gold/40 text-lg text-gold"
                >
                  {pledge.ornament}
                </span>
                <p className="mt-3 text-[0.6875rem] tracking-wide text-faint">
                  {pledge.ordinal}
                </p>
                <h3 className="mt-1 text-base font-semibold text-balance text-text sm:text-[1.0625rem]">
                  {pledge.title}
                </h3>
                <div className="gold-rule mx-auto mt-3 w-12" />
                <p className="mt-3 text-[0.8125rem] leading-relaxed text-muted">
                  {pledge.body}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Partner recruitment (§8.3) ───────────────────────────────────── */}
      <section aria-label={t('partnersTitle')} className="bg-bg">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:py-12">
          <div className="grid gap-6 rounded-card border border-line bg-card p-6 sm:p-7 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-12">
            <div>
              <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted">
                {t('partnersTitle')}
              </p>
              <h2 className="mt-1 font-display text-lg font-bold text-balance text-text sm:text-xl">
                {t('partnersSubtitle')}
              </h2>
              <p className="mt-2.5 max-w-[62ch] text-sm leading-relaxed text-muted">
                {/*
                  The commission comes from settings, never a hardcoded string. The super admin
                  edits it from the Rules Engine page (P-005), and this text has to follow
                  whatever they set.
                */}
                {t('partnersBody', {
                  rate: formatCustomerFee(settings, 'partnerRate', locale),
                })}
              </p>
            </div>

            {/*
              One button, not the prototype's two. Its "try the partner dashboard" control points
              at the partner PORTAL, which is a separate application on a different origin and has
              no address configured anywhere in this app — so the second button could only have
              been a dead link, and the footer already records why this site does not ship those.

              `.btn-gold` — the prototype's primary, the same one the header's sign-in draws. It
              was `sky`, because `text-bg` on `--color-gold` is 3.56:1 on a light surface and no
              foreground rescues it; the gradient rescues it by carrying its own dark foreground
              rather than borrowing the page's, and it measures 6.1:1 at its dark end.
            */}
            <Link
              href={`/${locale}/partners/join`}
              className="btn-gold inline-flex min-h-10 items-center justify-center justify-self-start rounded-lg px-6 text-sm font-bold transition-[opacity,scale] duration-200 ease-out-strong hover:opacity-90 active:scale-[.97]"
            >
              {t('partnersCta')}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * The eight stays «موصى به من سفرة», and the night they are priced for.
 *
 * ## Why this asks twice
 *
 * §5.3 closes same-day bookings at 17:00 in the CITY's timezone, and the API answers a search for
 * a closed night with a 400 carrying `firstBookableDate`. `searchSafely` turns that into an empty
 * list plus a notice rather than an exception — so the section, which hides itself when there is
 * nothing to show, disappeared from the landing page every evening after 17:00 Damascus time. Seven
 * hours of every day with a whole section missing, and nothing in any log to say why: measured at
 * 17:11 on 2026-09-02, with the API correctly refusing and the page correctly hiding.
 *
 * So a closed night is not an empty answer, it is a redirection: ask again from the date the API
 * itself named. One extra cached read, once per five minutes, and only on the evenings when the
 * first one came back closed.
 *
 * The dates travel back with the rows because the CARD links carry them. A row priced for tomorrow
 * whose links say today is a card that quotes a price and then refuses it on the next screen.
 */
async function recommendedStays(today: string, tomorrow: string) {
  /*
    Eight, not three. As a SLIDER the row needs more than fits, or the arrows never appear and it
    is a grid wearing a carousel's clothes. Eight is what booking.com's own carousels carry.
  */
  const ask = (checkIn: string, checkOut: string) =>
    searchSafely({ checkIn, checkOut, adults: 2, limit: 8 }, { cached: true });

  const first = await ask(today, tomorrow);

  if (first.items.length > 0 || !first.notice) {
    return { outcome: first, stay: stayQuery(today, tomorrow) };
  }

  const opens = first.notice.firstBookableDate;
  const leaves = dayAfter(opens);

  return { outcome: await ask(opens, leaves), stay: stayQuery(opens, leaves) };
}

/** The party and the nights, as the `?…` a card appends to its property link. */
function stayQuery(checkIn: string, checkOut: string): string {
  return `?checkIn=${checkIn}&checkOut=${checkOut}&adults=2`;
}

/**
 * A section's label and its heading.
 *
 * The small gold label above the heading is the prototype's, on every section — «الوجهات» over
 * «مدن تسهر معك». An earlier attempt deleted all five as a category of ornament; they are not
 * ornament here, they are the section's NAME, and the heading under each one is a sentence rather
 * than a label. The keys were always there for this: `destinationsTitle` is the label and
 * `destinationsSubtitle` is the heading.
 */
function SectionHeading({
  eyebrow,
  centred = false,
  children,
}: {
  eyebrow: string;
  centred?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={centred ? 'text-center' : undefined}>
      {/*
        The label is MUTED, not gold. The prototype sets it gold against night, where it is 7.9:1;
        the light theme's `--color-gold` is #a87a1f and the same label on the page measures 3.55:1,
        under the 4.5:1 floor for an 11px control. Muted is 5.6:1, and it is what booking.com's own
        section labels are. Gold stays where it still clears: the wordmark, the ornaments, the
        hairlines, and the button gradient that carries its own foreground.
      */}
      <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted">
        {eyebrow}
      </p>
      <h2 className="mt-1 font-display text-xl leading-snug font-bold text-balance text-text sm:text-2xl">
        {children}
      </h2>
    </div>
  );
}

/**
 * A destination.
 *
 * The prototype's card: a photograph, then the name with its category beside it and the country
 * and inventory count underneath. Where staff have uploaded no photograph the frame is filled with
 * the brand's ornament rather than left blank — a card that draws an empty box reads as a page
 * that failed to load, and three of the nine cities have no picture today.
 *
 * ## The title has no hover state of its own (Bashar, 2026-09-02)
 *
 * It underlined, which he asked to remove. Nothing replaces it and nothing needs to: the whole
 * card is one link, and hovering it already moves the border to gold and scales the photograph
 * inside its frame — two signals on the element the pointer is actually over. An underline on the
 * heading pointed at a smaller target than the one that responds.
 *
 * It is not recoloured either, and that is the measured half: `--color-gold` on the white card is
 * 3.55:1, and at 14–16px this heading needs 4.5:1, so a gold hover would have been a hover state
 * that fails contrast. The underline was what replaced it; now the border and the image carry it.
 */
function CityCard({
  city,
  locale,
  stays,
}: {
  city: City;
  locale: Locale;
  stays: (key: 'cityStays', values: { count: number }) => string;
}) {
  const categories = city.categories
    .map((category) => localisedName(category, locale))
    .join(' · ');

  return (
    <Link
      href={`/${locale}/city/${encodeURIComponent(city.slug)}`}
      className="group flex h-full flex-col overflow-hidden rounded-card border border-line bg-card transition-[border-color,scale] duration-200 ease-out-strong hover:border-gold/60 active:scale-[.985]"
    >
      {/*
        3:2, which is the ratio booking.com's carousel cards use — a destination photograph is a
        landscape, and 4:3 made the card taller than it was wide at every width.
      */}
      <div className="relative aspect-[3/2] overflow-hidden bg-band">
        {city.cover ? (
          <picture>
            <source srcSet={imageUrl(city.cover, 400, 'avif')} type="image/avif" />
            <source srcSet={imageUrl(city.cover, 400, 'webp')} type="image/webp" />
            <img
              src={imageUrl(city.cover, 400, 'webp')}
              /*
                Empty by design where staff have written none. The city's name is the next element
                in the reading order, so a screen reader that also announced the picture would hear
                the destination twice. Where alt text EXISTS it is used, because then it says
                something the name does not. This is the rule `geo.ts` states for the city page.
              */
              alt={localisedText(city.cover.alt, locale)}
              className="size-full object-cover transition-transform duration-500 ease-out-strong group-hover:scale-[1.05]"
              loading="lazy"
            />
          </picture>
        ) : (
          <OrnamentField
            id={`ornament-city-${city.slug}`}
            className="text-gold opacity-30"
          />
        )}
      </div>

      {/*
        The name on its own line, and the category beside the count under it.

        The prototype sets the category as a pill opposite the name, which works at its card width
        and not at ours: five across a 1152px container is a 208px card, and «صحراوية · تاريخية»
        in a pill next to «البتراء» left the name two characters of room. Below it, the pill has
        the full width and the row reads as one line of facts about the place.
      */}
      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-sm font-semibold text-text sm:text-base">
          {localisedName(city, locale)}
        </h3>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {categories ? (
            <span className="rounded-full border border-line bg-bg px-2 py-0.5 text-xs text-muted">
              {categories}
            </span>
          ) : null}
          <span className="text-xs text-faint">
            {city.countryCode}
            {city.propertyCount > 0
              ? ` · ${stays('cityStays', { count: city.propertyCount })}`
              : ''}
          </span>
        </div>
      </div>
    </Link>
  );
}

/**
 * One kind of stay, as a shortcut into search.
 *
 * The icon is drawn where this project has a drawing for the code and falls back to the glyph
 * staff chose otherwise — see `icons.tsx` for why that fallback is deliberate rather than
 * leftover. `StayIcon` catches the third case, a type with neither.
 */
function StayTypeCard({
  type,
  locale,
  stay,
  label,
  options,
}: {
  type: PropertyType;
  locale: Locale;
  stay: string;
  label: string;
  options: (key: 'typeOptions', values: { count: number }) => string;
}) {
  const Drawn = STAY_TYPE_ICONS[type.code];

  return (
    <Link
      href={`/${locale}/search${stay}&propertyTypeCode=${encodeURIComponent(type.code)}`}
      className="flex h-full flex-col items-center justify-center gap-2 rounded-card border border-line bg-bg px-3 py-4 text-center transition-[border-color,scale] duration-200 ease-out-strong hover:border-gold/60 active:scale-[.98]"
    >
      <span
        aria-hidden
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-gold/35 text-base text-gold"
      >
        {Drawn ? <Drawn /> : (type.glyph ?? <StayIcon />)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[0.8125rem] font-semibold text-text">
          {label}
        </span>
        <span className="mt-0.5 block text-[0.6875rem] text-faint">
          {options('typeOptions', { count: type.propertyCount })}
        </span>
      </span>
    </Link>
  );
}

function tomorrowInDamascus(): string {
  return dayAfter(todayInDamascus());
}

/** The next calendar day, over the month and year boundaries `Date.UTC` already handles. */
function dayAfter(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}
