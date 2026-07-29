import { getTranslations } from 'next-intl/server';

import type { Locale } from '@/i18n/routing';
import { localisedName } from '@/lib/localise';

interface City {
  slug: string;
  nameAr: string;
  nameEn: string;
  nameDe: string;
}

/**
 * The search engine from §5.1 / §5.2.
 *
 * A plain GET form with no client JavaScript. That is a deliberate choice, not a
 * shortcut: the search state lives entirely in the URL, so results are
 * shareable, linkable, indexable and survive a page reload — and the form works
 * before any script has loaded, which matters on the mobile networks these
 * markets actually use.
 *
 * §5.2 makes arrival, departure and guests mandatory, so those inputs are
 * `required` and the browser enforces it before a request is even made.
 */
export async function SearchForm({
  locale,
  cities,
  defaults,
  minDate,
}: {
  locale: Locale;
  cities: City[];
  defaults?: {
    citySlug?: string | undefined;
    checkIn?: string | undefined;
    checkOut?: string | undefined;
    adults?: number | undefined;
  };
  minDate: string;
}) {
  const t = await getTranslations('search');

  return (
    <form
      action={`/${locale}/search`}
      method="get"
      className="grid gap-3 rounded-card border border-line bg-card/80 p-4 sm:grid-cols-2 lg:grid-cols-5"
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted">{t('destinationOptional')}</span>
        <select
          name="citySlug"
          defaultValue={defaults?.citySlug ?? ''}
          className="rounded-lg border border-line bg-field px-3 py-2.5 text-text"
        >
          <option value="">{t('allCities')}</option>
          {cities.map((city) => (
            <option key={city.slug} value={city.slug}>
              {localisedName(city, locale)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted">
          {t('checkIn')} <span className="text-gold">*</span>
        </span>
        <input
          type="date"
          name="checkIn"
          required
          // §5.3: today is not selectable once the city's 17:00 cutoff has passed.
          // The API re-checks, but blocking it here avoids a pointless round trip.
          min={minDate}
          defaultValue={defaults?.checkIn ?? minDate}
          className="rounded-lg border border-line bg-field px-3 py-2.5 text-text"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted">
          {t('checkOut')} <span className="text-gold">*</span>
        </span>
        <input
          type="date"
          name="checkOut"
          required
          min={minDate}
          defaultValue={defaults?.checkOut ?? ''}
          className="rounded-lg border border-line bg-field px-3 py-2.5 text-text"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted">
          {t('guests')} <span className="text-gold">*</span>
        </span>
        <select
          name="adults"
          defaultValue={String(defaults?.adults ?? 2)}
          className="rounded-lg border border-line bg-field px-3 py-2.5 text-text"
        >
          {[1, 2, 3, 4, 5, 6, 8].map((count) => (
            <option key={count} value={count}>
              {t('guestsCount', { count })}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        className="self-end rounded-lg bg-gold px-5 py-2.5 font-semibold text-bg transition-opacity hover:opacity-90"
      >
        {t('submit')}
      </button>
    </form>
  );
}
