import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { notFound } from 'next/navigation';

import { SearchForm } from '@/components/search-form';
import { CardSlider } from '@/components/card-slider';
import { PledgeCards } from '@/components/pledge-cards';
import { ServiceCards } from '@/components/service-cards';
import { GroupTripCard } from '@/components/group-trip-card';
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
  type PropertyType,
} from '@/lib/catalog';
import { searchSafely } from '@/lib/api';
import { partnerApplicationsOpen } from '@safra/contracts';
import { formatCustomerFee, partnerRate, todayInDamascus } from '@/lib/settings';
import { dayAfter, night, retryFrom } from '@/lib/bookable-night';
import { dynamicMessage } from '@/lib/dynamic-message';
import { getGroupTrips, upcomingTrips } from '@/lib/group-trips';
import { localeAlternates } from '@/lib/alternates';

export const revalidate = 300;

/**
 * The home page's own canonical and alternates. It declared none and relied on the layout's
 * default, which also leaked onto every page that declared none (see `localeAlternates`). The
 * title and description still come from the layout.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  if (!isLocale(locale)) return {};

  return { alternates: localeAlternates(locale, '') };
}

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
 * destinations, stay types, «موصى به من سفرة», the three pledges, and the partner band. The four
 * booking steps gave their place to the group trips (Bashar, 2026-10-02), and the destinations to
 * SAFRA's six services when the cities page was removed (2026-10-04). Two earlier attempts invented compositions of their own instead of reading it; the
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
  const tg = await getTranslations('groups');

  const today = todayInDamascus();
  const tomorrow = tomorrowInDamascus();

  /*
    Five independent reads, none of which depends on another, so none of them waits.

    The search is the only new one and it is the CACHED reader — the same one the city page's
    teaser uses, for the same reason and with the same explicit trade-off: it is marketing content,
    a visitor's next step queries live availability, and the booking endpoint re-validates against
    the exclusion constraint regardless. `searchSafely` never throws, so a search that fails or a
    same-day cutoff that has passed leaves the section absent rather than the page broken.
  */
  const [cities, propertyTypes, settings, recommended, trips] = await Promise.all([
    getCities(),
    getPropertyTypes(),
    getPublicSettings(),
    recommendedStays(today, tomorrow),
    getGroupTrips(),
  ]);

  const upcoming = upcomingTrips(trips);

  const trust = [
    { icon: VerifiedIcon, label: t('trustVerified') },
    { icon: WalletIcon, label: t('trustPayment') },
    { icon: CompensationIcon, label: t('trustCompensation') },
  ];

  /* Drawn by `PledgeCards`, which «عن سفرة» shares, with each pledge's icon fixed to it there. */
  const pledges = [
    { ordinal: t('pledgeOrdinal1'), title: t('pledge1Title'), body: t('pledge1Body') },
    { ordinal: t('pledgeOrdinal2'), title: t('pledge2Title'), body: t('pledge2Body') },
    { ordinal: t('pledgeOrdinal3'), title: t('pledge3Title'), body: t('pledge3Body') },
  ] as const;

  /*
    The night every link into search carries — the one the API said was bookable, not the one the
    clock says. See `nights` for what pre-filling today cost between 17:00 and midnight.
  */
  const stay = recommended.stay;

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
      {/*
        From `lg` the hero starts UNDER the bar rather than below it: `-mt` pulls it up by the
        header's own height and the inner padding puts the content back, so the transparent bar
        floats on this gradient instead of on a flat band above it. `--header-h` is the single
        number both sides read — see the note in `globals.css`.

        Below `lg` the bar wraps to two rows and has no fixed height, so nothing is pulled and the
        hero simply follows it. A pull-up shorter than a wrapped bar would put the brand on top of
        the headline.
      */}
      <section className="bg-[radial-gradient(1200px_600px_at_50%_-80px,var(--color-hero),var(--color-band)_45%,var(--color-bg))] lg:-mt-[var(--header-h)]">
        <div className="mx-auto max-w-5xl px-4 pt-8 pb-10 text-center sm:pt-14 sm:pb-12 lg:pt-[calc(var(--header-h)+3.5rem)]">
          {/*
            58px is the prototype's size; `clamp` gets there continuously rather than stepping at
            two breakpoints, and holds the Arabic headline on one line from about 900px up.

            **And the padding is not decoration.** `background-clip: text` paints the gradient only
            inside the element's own box, and Amiri's ascent and descent together come to more than
            1.6em: measured at 58px, the ink ran 5px above the box and 4.2px below it, so the top of
            «سفرة» and the tail of «تبدأ» were simply not painted. `py-1.5` grows the painting area
            past the ink; `mt-2.5` and `-mb-1.5` give the six pixels back, so nothing moves.

            **`leading-[1.6]` is the prototype's too — 92.8px on 58px — and it is load-bearing, not
            taste.** At 1.18 the line box was shorter than the face's own ascent and descent, so
            Amiri's Arabic clipped top and bottom (Bashar screenshotted it). `bg-clip-text` makes
            that worse rather than better: the gradient is clipped to the glyphs, so anything the
            line box cuts is simply not painted.
          */}
          <h1 className="mt-2.5 -mb-1.5 bg-[image:var(--hero-title-grad)] bg-clip-text py-1.5 font-display text-[clamp(2rem,4.6vw,3.625rem)] leading-[1.6] font-bold text-balance text-transparent">
            {t('heroTitle')}
          </h1>

          {/*
            `#5C6377` and line-height 1.8 are sampled from the prototype, not inferred, and the
            colour is a literal on purpose (Bashar, 2026-09-03: «should be exactly same as the html
            file»).

            **17px is the prototype's; the WEIGHT is not.** The file sets 400 and this is 500, asked
            for on 2026-09-03 («should be weighter and bigger»). The size went to 19px in the same
            breath and came back to 17 an hour later, which settles it: the line needed more
            presence, not more room. Weight was the half that was doing the work.

            One size at every width, deliberately — 17px is already comfortable on a 390px screen,
            and a line that only reaches its intended size on a desktop is a line nobody on a phone
            ever reads as intended.

            It is the handoff's own `--muted`. This product's `--muted` is DARKER (#454B5A), because
            he asked twice for the greys to be readable at caption sizes — see the note in
            `globals.css`. On the light page the file's lighter grey measures 5.55:1 and clears the
            floor, so honouring it costs nothing there, and the deviation stays where it was earned:
            the small text.

            **It is a token rather than a literal because a literal has no theme.** `text-[#5c6377]`
            measured 3.26:1 on the dark page — this sentence, unreadable, in the theme the prototype
            does not describe. `--color-handoff-muted` is the file's value to the byte in the light
            theme and this product's own muted (8.11:1) in the dark one.
          */}
          {/*
            Two lines, as Bashar set them out (2026-10-04): what you can book and the payment
            promise on the first, the care promise on its own line beneath it. The break is a
            BLOCK span rather than a `<br>`, so the second sentence always starts its own line and
            a phone still wraps the first one wherever it must. No `max-w-[62ch]` any more: at 62
            characters the first sentence wrapped on every desktop, and the line he asked for only
            exists if it can be one line where the screen allows.
          */}
          <p className="mx-auto mt-4 text-17 leading-[1.8] font-medium text-handoff-muted">
            {t('heroSubtitle')} {t('heroPromiseLead')}
            <span className="block">{t('heroPromiseCare')}</span>
          </p>

          <div className="mt-6 text-start">
            <SearchForm
              locale={locale}
              cities={cities}
              propertyTypes={propertyTypes}
              minDate={recommended.checkIn}
              attributes={TRIP_FEATURES.map((code) => ({ code, label: ta(code) }))}
              attributesLabel={t('attributesLabel')}
            />
          </div>

          {/*
            The three promises, as the prototype sets them: one line, marked with the brand's own
            star, centred under the bar. They were a boxed grid in an earlier attempt, which made
            one statement in three parts read as three separate offers.
          */}
          <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {trust.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2 text-14 text-muted">
                <span aria-hidden className="shrink-0 text-gold">
                  <Icon />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── SAFRA's services ──────────────────────────────────────────────── */}
      {/*
        The six services, where «مدن تسهر معك» and its city slider were (Bashar, 2026-10-04: the
        cities page is gone, «I do not need it anymore», and screenshot «14.59.04» takes its place).
        No heading, as the reference has none: the six drawings and names are the statement.
      */}
      <section aria-label={t('services.label')} className="bg-bg">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:py-12">
          <ServiceCards
            locale={locale}
            copy={{
              names: {
                rides: t('services.names.rides'),
                stay: t('services.names.stay'),
                medical: t('services.names.medical'),
                trips: t('services.names.trips'),
                umrah: t('services.names.umrah'),
                realEstate: t('services.names.realEstate'),
              },
              covers: {
                rides: t('services.covers.rides'),
                stay: t('services.covers.stay'),
                medical: t('services.covers.medical'),
                trips: t('services.covers.trips'),
                umrah: t('services.covers.umrah'),
                realEstate: t('services.covers.realEstate'),
              },
              soon: t('services.soon'),
            }}
          />
        </div>
      </section>

      {/*
        Nothing on this page shrinks when it is pressed (Bashar, 2026-09-03, the third time he has
        said it — the slider arrows in August, the trip tags this morning, these tiles now). The
        press is answered in colour: the border warms and a faint gold wash arrives. A tile that
        changes SIZE under a finger moves the two tiles beside it, which is the part that reads as
        cheap rather than responsive.
      */}
      {/* ── Types of stay (§8.2) ─────────────────────────────────────────── */}
      <section
        aria-label={t('typesTitle')}
        className="bg-[linear-gradient(var(--color-bg),var(--color-bg2))]"
      >
        <div className="mx-auto max-w-7xl px-4 py-10 sm:py-12">
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
          <div className="mx-auto max-w-7xl px-4 py-10 sm:py-12">
            <SectionHeading eyebrow={t('recommendedTitle')}>
              {t('recommendedSubtitle')}
            </SectionHeading>

            {/*
              `PropertyCard` unchanged — the same card the search results use. A second card for
              the same object is how two surfaces come to disagree about a price, and this one
              already converts to the reader's currency, prints the original underneath when it
              did, and renders the two SAFRA badges the prototype shows.
            */}
            {/*
              The same `CardSlider` the group trips use (Bashar, 2026-09-02), so the rows on
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
                    className="flex w-[16rem] shrink-0 snap-start sm:w-[calc((100%-0.75rem)/2)] lg:w-[calc((100%-1.5rem)/3)] xl:w-[calc((100%-2.25rem)/4)]"
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

      {/* ── جروبات: the group trips SAFRA runs itself ────────────────────── */}
      {/*
        In the place «كيف يعمل الحجز» held (Bashar, 2026-10-02). That section explained that booking
        is not instant; the same promise is still made where the decision is, on the property page
        and at checkout, and the trust bar under the hero still names the compensation.

        Only trips still to come: a finished trip is history on the groups page, where it is labelled
        as such, and an advertisement for a trip nobody can join is a dead end on the front page.
        Absent rather than empty when there are none, for the reason «مختارات» gives.
      */}
      {upcoming.length > 0 ? (
        <section aria-label={tg('title')} className="bg-bg">
          <div className="mx-auto max-w-7xl px-4 py-10 sm:py-12">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <SectionHeading eyebrow={tg('title')}>{t('groupsSubtitle')}</SectionHeading>
              <Link
                href={`/${locale}/groups`}
                className="inline-flex min-h-10 items-center gap-1.5 text-14 font-semibold text-sky underline-offset-4 transition-colors duration-150 ease-out hover:text-gold-read hover:underline lg:min-h-0"
              >
                {t('groupsAll')}
              </Link>
            </div>

            {/*
              The same `CardSlider` and the same widths as «موصى به من سفرة», so the rows on
              this page scroll alike. `GroupTripCard` unchanged from the groups page: one card for
              one object, so a trip cannot read differently on the front page.
            */}
            <div className="mt-5">
              <CardSlider
                labels={{ previous: t('groupsPrevious'), next: t('groupsNext') }}
              >
                {upcoming.map((trip) => (
                  <GroupTripCard
                    key={trip.slug}
                    trip={trip}
                    locale={locale}
                    className="flex w-[16rem] shrink-0 snap-start sm:w-[calc((100%-0.75rem)/2)] lg:w-[calc((100%-1.5rem)/3)] xl:w-[calc((100%-2.25rem)/4)]"
                    labels={{
                      priceFrom: (amount) => tg('priceFrom', { amount }),
                      priceOnRequest: tg('priceOnRequest'),
                      nights: (n) => tg('nights', { n }),
                      seats: (n) => tg('seats', { n }),
                      past: tg('past'),
                    }}
                  />
                ))}
              </CardSlider>
            </div>
          </div>
        </section>
      ) : null}

      {/*
        ── The three pledges (P-001, P-002, P-007) ────────────────────────

        With the partner section closed this is the last band on the page, and the footer's
        `mt-16` would show as a strip of page background between two tinted bands (Bashar,
        2026-10-07). So the band runs on through that margin instead of stopping short of it.
      */}
      <section
        aria-label={t('pledgesTitle')}
        className={`bg-[linear-gradient(var(--color-bg),var(--color-band))] ${partnerApplicationsOpen(settings) ? '' : '-mb-16 pb-16'}`}
      >
        <div className="mx-auto max-w-7xl px-4 py-12 sm:py-14">
          <SectionHeading eyebrow={t('pledgesTitle')} centred>
            {t('pledgesSubtitle')}
          </SectionHeading>

          <div className="mt-7">
            <PledgeCards pledges={pledges} />
          </div>
        </div>
      </section>

      {/*
        ── Partner recruitment (§8.3) ─────────────────────────────────────

        The whole section, not only its button, goes when the super admin closes the form
        (2026-10-04): an offer to list a property with nothing to press is a dead end.
      */}
      {partnerApplicationsOpen(settings) ? (
        <section aria-label={t('partnersTitle')} className="bg-bg">
          <div className="mx-auto max-w-7xl px-4 py-10 sm:py-12">
            <div className="grid gap-6 rounded-card border border-line bg-card p-6 sm:p-7 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-12">
              <div>
                {/* Gold, 12px/700 — the same label treatment every other section on this page has. */}
                <p className="text-13 font-bold tracking-[0.08em] text-gold-read">
                  {t('partnersTitle')}
                </p>
                {/*
                Bigger (Bashar, 2026-09-03: «too small — make the font and the button bigger»). This
                is the one place on the page addressed to somebody with a building to list rather
                than a night to book, and it was set two steps below every other section heading, so
                it read as a footnote to the page instead of an offer on it.
              */}
                <h2 className="mt-1 font-display text-2xl font-bold text-balance text-text sm:text-28">
                  {t('partnersSubtitle')}
                </h2>
                <p className="mt-3 max-w-[62ch] text-16 leading-relaxed text-muted">
                  {/*
                  The commission comes from settings, never a hardcoded string. The super admin
                  edits it from the Rules Engine page (P-005), and this text has to follow
                  whatever they set. With no rate configured the sentence drops its commission
                  clause rather than printing a dash where a percentage belongs.
                */}
                  {partnerRate(settings) === null
                    ? t('partnersBodyNoRate')
                    : t('partnersBody', {
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
                className="btn-gold inline-flex min-h-12 items-center justify-center justify-self-start rounded-lg px-8 text-16 font-bold sm:min-h-[52px]"
              >
                {t('partnersCta')}
              </Link>
            </div>
          </div>
        </section>
      ) : null}
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
  const again = retryFrom(first);

  if (!again) return { outcome: first, ...night(today, tomorrow) };

  return { outcome: await ask(again.checkIn, again.checkOut), ...again };
}

/**
 * A section's label and its heading.
 *
 * The small gold label above the heading is the prototype's, on every section — «أنواع الإقامة»
 * over its sentence. An earlier attempt deleted all five as a category of ornament; they are not
 * ornament here, they are the section's NAME, and the heading under each one is a sentence rather
 * than a label: `typesTitle` is the label and `typesSubtitle` the heading. The services row is the
 * one section without either, because the reference it was built from has none.
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
        GOLD, 12px, 700 — sampled from the prototype in the light theme, not inferred. An earlier
        pass made this muted on contrast grounds (3.56:1 against the 4.5 floor) and the note here
        argued for it; Bashar has since asked twice for the design's own colours, and the gold inks
        are recorded as his decision in `e2e/contrast.spec.ts`. The design wins.
      */}
      <p className="text-13 font-bold tracking-[0.08em] text-gold-read">{eyebrow}</p>
      <h2 className="mt-1.5 font-display text-26 leading-snug font-bold text-balance text-text sm:text-32">
        {children}
      </h2>
    </div>
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
      className="flex h-full flex-col items-center justify-center gap-2 rounded-card border border-line bg-card px-3 py-4 text-center transition-[border-color,background-color] duration-200 ease-out-strong hover:border-gold/60 hover:bg-gold/5"
    >
      {/*
        No ring, and the mark carries the card (Bashar, 2026-09-13: «make the icons bigger and
        remove the circle around them»). It was an 18px glyph inside a 36px `rounded-full` hairline,
        so the ring was the largest thing in the cell and the drawing the smallest thing inside it.

        The size is on the SPAN, not in `ICON`: every glyph is `1.15em`, so `text-28` here
        draws 32px without touching the search bar or the amenity cells. `type.glyph` — the emoji
        staff chose for a type nobody has drawn yet — scales with it, which is the other reason the
        size belongs on the container rather than on the svg.
      */}
      <span
        aria-hidden
        className="inline-flex shrink-0 items-center justify-center text-28 leading-none text-gold-read"
      >
        {Drawn ? <Drawn /> : (type.glyph ?? <StayIcon />)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-14 font-semibold text-text">{label}</span>
        <span className="mt-0.5 block text-13 text-faint">
          {options('typeOptions', { count: type.propertyCount })}
        </span>
      </span>
    </Link>
  );
}

function tomorrowInDamascus(): string {
  return dayAfter(todayInDamascus());
}
