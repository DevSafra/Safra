import { getTranslations } from 'next-intl/server';

import { TRIP_ATTRIBUTES } from '@safra/contracts';
import { StarRating } from '@safra/ui';

import type { Locale } from '@/i18n/routing';
import type { Amenity, PropertyType } from '@/lib/catalog';
import { localisedName } from '@/lib/localise';
import { dynamicMessage } from '@/lib/dynamic-message';

/** The five values, written once — the same list the partner and console forms offer. */
const STAR_VALUES = [1, 2, 3, 4, 5] as const;

/**
 * The filters beside the results (§5.5), as booking.com places them.
 *
 * ## Everything here was already in the contract and none of it was reachable
 *
 * `searchQuerySchema` has accepted `minPrice`, `maxPrice`, `propertyTypeCode`, `attributes`,
 * `amenityCodes` and `freeCancellationOnly` since it was written. The results page offered a sort
 * order and nothing else, so a visitor looking for a sea-view flat under $80 with free cancellation
 * had to read every card. The capability existed and the screen did not — the shape §"Built is not
 * driven" exists to catch.
 *
 * ## A GET form, not a client component
 *
 * The whole panel is one `<form method="get">` pointed at the same route. That is deliberate and it
 * buys four things at once:
 *
 * - **The view is in the URL**, so a filtered search is shareable, bookmarkable and reload-safe —
 *   the same reason the console's paging lives there.
 * - **It works with no JavaScript**, before hydration and after it fails. A search page that needs
 *   a bundle to filter is a search page that is blank on a slow connection.
 * - **Nothing is reflected.** The hidden fields carry values the PAGE parsed and clamped, never the
 *   raw query string, so a crafted `?evil=…` cannot ride along into a link or a field on our own
 *   page. This is `returnQuery`'s allow-list rule applied to a form.
 * - **The cursor is dropped on purpose.** Applying a filter must return to the first page: keeping
 *   an offset across a change of criteria lands the reader on page three of a result set that now
 *   has one page, which reads as "no results" for a search that has plenty.
 *
 * ## A disclosure on a phone, a permanent sidebar on a desktop
 *
 * On a phone this panel is a screenful of controls sitting on top of the results, so it collapses
 * into a `<details>` whose summary says how many filters are active. `<details>` rather than a
 * scripted toggle: it is the platform's own disclosure, keyboard-operable and announced by a screen
 * reader without a line of JavaScript, and it works before hydration.
 *
 * At `lg` there is a column for it and it must never be closed. The element is rendered CLOSED —
 * the server cannot know the viewport, and rendering `open` would hand a phone the screenful this
 * exists to avoid — and two things reveal it from `lg`: `lg:flex` on the form, and
 * `.disclosure-open-lg` in `globals.css`, which is the half that is easy to miss. Chrome hides a
 * closed disclosure's subtree through `content-visibility` on `::details-content`, and no property
 * on a descendant overrides that: the form here computed `display: flex` with a 1911px box and was
 * still not rendered. See the note beside that rule for why a height measurement said otherwise.
 */
export async function SearchFilters({
  locale,
  propertyTypes,
  amenities,
  carried,
  active,
}: {
  locale: Locale;
  propertyTypes: PropertyType[];
  amenities: Amenity[];
  /**
   * The criteria the results were fetched with, to be repeated as hidden fields.
   *
   * A GET form submits ONLY its own controls, so anything absent here is silently dropped on the
   * first filter change — which is how a filter panel loses somebody's dates and quietly re-searches
   * tonight for two adults.
   */
  carried: {
    citySlug: string | undefined;
    checkIn: string;
    checkOut: string;
    adults: number;
    children: number;
    infants: number;
    /** Part of the SEARCH, like the dates and the party — see `cleared` below. */
    bedrooms: number;
    sort: string;
  };
  active: {
    propertyTypeCode: string | undefined;
    attributes: string[];
    starRatings: number[];
    amenityCodes: string[];
    minPrice: number | undefined;
    maxPrice: number | undefined;
    freeCancellationOnly: boolean;
  };
}) {
  const t = await getTranslations('search');
  const tt = await getTranslations('propertyTypes');
  const ta = await getTranslations('attributes');
  const ts = await getTranslations('starRating');
  const tm = await getTranslations('amenities');

  /*
    Only amenities a visitor can actually find something with. See the note on the endpoint: the
    link table was empty while the catalogue listed twelve, so every checkbox would have emptied
    the page. An amenity joins this list the moment a published stay has it — nothing to remember.

    A code that is no longer offered is also dropped from `active` by the page, so a bookmarked
    filter for a withdrawn amenity does not leave a checked box nobody can see.
  */
  const offered = amenities.filter((one) => one.propertyCount > 0);

  const count =
    (active.propertyTypeCode ? 1 : 0) +
    active.attributes.length +
    active.starRatings.length +
    active.amenityCodes.length +
    (active.minPrice === undefined ? 0 : 1) +
    (active.maxPrice === undefined ? 0 : 1) +
    (active.freeCancellationOnly ? 1 : 0);

  /* Clearing keeps the SEARCH and drops the filters — the dates are not a filter. */
  const cleared = new URLSearchParams({
    checkIn: carried.checkIn,
    checkOut: carried.checkOut,
    adults: String(carried.adults),
    children: String(carried.children),
    infants: String(carried.infants),
    sort: carried.sort,
  });

  if (carried.citySlug) cleared.set('citySlug', carried.citySlug);
  /*
    Bedrooms SURVIVES a clear, because it is not a filter — it is asked in the search form beside
    the dates and the party, and «امسح الفلاتر» must not silently widen what somebody searched for.
    Set only when non-zero, so a cleared URL stays as short as it was.
  */
  if (carried.bedrooms > 1) cleared.set('bedrooms', String(carried.bedrooms));

  return (
    <details className="disclosure-open-lg group rounded-card border border-line bg-card lg:sticky lg:top-24">
      {/*
        `list-none` handles Chrome and Firefox; Safari draws its own `::-webkit-details-marker` and
        ignores `list-style`, so a triangle would appear beside the word on that browser only.
        `lg:cursor-default` because from `lg` the body is shown regardless — a pointer promising a
        toggle that changes nothing visible is a small lie.
      */}
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-bold text-text lg:cursor-default [&::-webkit-details-marker]:hidden">
        <span>{t('filters')}</span>
        <span className="flex items-center gap-2">
          {count > 0 ? (
            <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[0.6875rem] font-semibold text-gold">
              {t('filtersActive', { count })}
            </span>
          ) : null}
          {/* Rotates with the disclosure rather than swapping glyph — one element, one transition. */}
          <ChevronIcon />
        </span>
      </summary>

      <form
        method="get"
        className="hidden flex-col gap-5 border-t border-line p-4 group-open:flex lg:flex"
      >
        {/*
          The search itself, repeated. `citySlug` is only emitted when there IS one: an empty
          `citySlug=` is a different query from an absent one to a schema that treats the field as
          optional, and «كل المدن» must not become a city named "".
        */}
        <input type="hidden" name="checkIn" value={carried.checkIn} />
        <input type="hidden" name="checkOut" value={carried.checkOut} />
        <input type="hidden" name="adults" value={carried.adults} />
        <input type="hidden" name="children" value={carried.children} />
        <input type="hidden" name="infants" value={carried.infants} />
        {carried.bedrooms > 1 ? (
          <input type="hidden" name="bedrooms" value={carried.bedrooms} />
        ) : null}
        <input type="hidden" name="sort" value={carried.sort} />
        {carried.citySlug ? (
          <input type="hidden" name="citySlug" value={carried.citySlug} />
        ) : null}

        {/* ── Price ──────────────────────────────────────────────────────── */}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[0.85rem] font-bold text-text">
            {t('priceRange')}
          </legend>

          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-[0.6875rem] text-muted">
              {t('priceFrom')}
              {/*
                No `dir` at all, which gives the page's own direction — the rule for a field a
                person TYPES INTO. Digits are a left-to-right RUN and the bidi algorithm lays one
                out correctly inside an RTL field without being told; `dir="ltr"` would move the
                field's start edge and put the caret on the wrong side of its own label.
              */}
              <input
                type="number"
                name="minPrice"
                min={0}
                max={1_000_000}
                inputMode="numeric"
                defaultValue={active.minPrice ?? ''}
                className="min-h-11 w-full rounded-lg border border-line bg-field px-3 text-sm text-text"
              />
            </label>
            <label className="grid gap-1 text-[0.6875rem] text-muted">
              {t('priceTo')}
              <input
                type="number"
                name="maxPrice"
                min={0}
                max={1_000_000}
                inputMode="numeric"
                defaultValue={active.maxPrice ?? ''}
                className="min-h-11 w-full rounded-lg border border-line bg-field px-3 text-sm text-text"
              />
            </label>
          </div>

          {/*
            Said, because it is the one thing about this filter a reader cannot infer. The API
            filters in the LISTING's currency and the cards render in the visitor's chosen one, so
            «100» here and «$US 100» on a card are not necessarily the same number. Converting the
            range instead would silently exclude every listing priced in a currency whose rate is
            stale — a filter that hides inventory without saying so.
          */}
          <p className="text-[0.6875rem] leading-relaxed text-faint">
            {t('priceCurrencyNote')}
          </p>
        </fieldset>

        {/* ── Free cancellation ──────────────────────────────────────────── */}
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-text">
          <input
            type="checkbox"
            name="freeCancellationOnly"
            value="true"
            defaultChecked={active.freeCancellationOnly}
            className="size-4 shrink-0 accent-gold"
          />
          {t('freeCancellation')}
        </label>

        {/* ── Property type ──────────────────────────────────────────────── */}
        {propertyTypes.length > 0 ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-[0.85rem] font-bold text-text">
              {t('propertyType')}
            </legend>

            {/*
              Radios, not a select: the set is short, and «كل الأنواع» has to be a real, pressable
              way BACK to no filter. A select's empty option looks like a placeholder rather than a
              choice, and this one is the choice most people make second.
            */}
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-muted">
              <input
                type="radio"
                name="propertyTypeCode"
                value=""
                defaultChecked={!active.propertyTypeCode}
                className="size-4 shrink-0 accent-gold"
              />
              {t('anyPropertyType')}
            </label>

            {propertyTypes.map((type) => (
              <label
                key={type.code}
                className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-muted"
              >
                <input
                  type="radio"
                  name="propertyTypeCode"
                  value={type.code}
                  defaultChecked={active.propertyTypeCode === type.code}
                  className="size-4 shrink-0 accent-gold"
                />
                <span className="flex-1">
                  {dynamicMessage(tt, type.code, localisedName(type, locale))}
                </span>
                <span className="text-[0.6875rem] text-faint">{type.propertyCount}</span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {/*
          ── Star classification ─────────────────────────────────────────────

          Here, in «التصفية», rather than on the search bar (Bashar, 2026-09-04). It was a chip row
          under «صفات الرحلة» in the bar, and the bar is the QUERY — where, when, how many — while
          this panel is how a reader narrows what came back. A classification is a narrowing.

          Immediately after «نوع الإقامة», because it classifies the type: choosing «فندق» and then
          «٤ نجوم» is one thought, and the two controls now sit together.

          Checkboxes rather than radios, so «4 or 5 stars» is expressible — a property has exactly
          one classification, so the API ORs them. And the same drawn stars the cards use, because a
          reader picking 4 should see the shape they will be shown.
        */}
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-[0.85rem] font-bold text-text">
            {t('starRating')}
          </legend>

          {STAR_VALUES.map((value) => (
            <label
              key={value}
              className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-muted"
            >
              <input
                type="checkbox"
                name="starRatings"
                value={value}
                defaultChecked={active.starRatings.includes(value)}
                className="size-4 shrink-0 accent-gold"
              />
              {/*
                `decorative`, because the label's own text already names the rating — letting the
                component announce itself as well reads it twice per row.
              */}
              <StarRating
                value={value}
                label={ts('stars', { count: value })}
                decorative
              />
              <span className="sr-only">{ts('stars', { count: value })}</span>
            </label>
          ))}

          {/*
            Said, because it is the one thing about this filter a reader cannot infer: a star
            classification is a HOTEL classification, so narrowing by it excludes every apartment
            and chalet in the results. A filter that silently removes whole categories of
            inventory is the failure the price note beside it exists to prevent.
          */}
          <p className="mt-1 text-[0.6875rem] leading-relaxed text-faint">
            {t('starRatingHotelsOnly')}
          </p>
        </fieldset>

        {/* ── Trip attributes ────────────────────────────────────────────── */}
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-[0.85rem] font-bold text-text">
            {t('attributes')}
          </legend>

          {TRIP_ATTRIBUTES.map((code) => (
            <label
              key={code}
              className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-muted"
            >
              <input
                type="checkbox"
                name="attributes"
                value={code}
                defaultChecked={active.attributes.includes(code)}
                className="size-4 shrink-0 accent-gold"
              />
              {ta(code)}
            </label>
          ))}
        </fieldset>

        {/* ── Amenities ──────────────────────────────────────────────────── */}
        {offered.length > 0 ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-[0.85rem] font-bold text-text">
              {t('amenitiesTitle')}
            </legend>

            {offered.map((amenity) => (
              <label
                key={amenity.code}
                className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-muted"
              >
                <input
                  type="checkbox"
                  name="amenityCodes"
                  value={amenity.code}
                  defaultChecked={active.amenityCodes.includes(amenity.code)}
                  className="size-4 shrink-0 accent-gold"
                />
                <span className="flex-1">
                  {/*
                    The catalogue's own name is the fallback, never the raw code: an amenity a
                    staff member adds tomorrow has no key here, and «pets_allowed» on a filter is
                    worse than the Arabic name the database already holds.
                  */}
                  {dynamicMessage(tm, amenity.code, localisedName(amenity, locale))}
                </span>
                <span className="text-[0.6875rem] text-faint">
                  {amenity.propertyCount}
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <button
            type="submit"
            className="btn-gold min-h-11 cursor-pointer rounded-lg px-4 text-sm font-bold transition-[opacity] duration-200 ease-out-strong hover:opacity-90"
          >
            {t('filtersApply')}
          </button>

          {count > 0 ? (
            <a
              href={`/${locale}/search?${cleared.toString()}`}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-4 text-sm font-semibold text-muted transition-colors duration-200 ease-out-strong hover:border-gold/60 hover:bg-gold/10 hover:text-text"
            >
              {t('filtersClear')}
            </a>
          ) : null}
        </div>
      </form>
    </details>
  );
}

function ChevronIcon() {
  return (
    <svg
      aria-hidden
      width="1.1em"
      height="1.1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      /*
        Down when closed, up when open. `rotate` transitions where a glyph swap cannot, and the
        arrow means "this opens downward" — a physical direction, not a reading one, so it is NOT
        mirrored under RTL. Hidden from `lg`, where the panel never closes.
      */
      className="shrink-0 text-faint transition-transform duration-200 ease-out-strong group-open:-rotate-180 lg:hidden"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
