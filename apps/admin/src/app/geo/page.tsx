import Link from 'next/link';

import { getCityCategories, getGeography, type Geography } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { FootNote } from '@/components/admin-table';
import { TableToolbar } from '@/components/table-toolbar';
import { t } from '@/lib/strings';
import { listParams } from '@/lib/search-params';
import { mediaBase, mediaUrl } from '@safra/session';
import { AddCity, AddCountry, AddCurrency } from '@/components/geo-add-forms';
import { CountryRows, CurrencyRows } from '@/components/geo-row-editors';
import { GeoCities } from '@/components/geo-city-editor';
import { refuseSection } from '@/components/section-refusal';

/**
 * المدن والدول والعملات (design handoff §8).
 *
 * The screen exists because of P-005: launch geography and exchange rates are OPERATIONAL
 * values adjusted by staff, not constants a developer edits and deploys. The handoff says it
 * outright — "أسعار الصرف تُعدَّل من هنا لا من الكود".
 *
 * ## Writable since 2026-08-30
 *
 * The three «+ إضافة» buttons were rendered disabled, and every city row was a dead end: a market
 * could be opened only by a migration and could not be closed at all. Bashar asked for all of it,
 * and P-005 had asked for it first — launch geography is an OPERATIONAL value staff adjust.
 *
 * Nothing DELETES. A country, city or currency is referenced by bookings and ledger rows that
 * outlive any decision to stop selling there; `isActive` is how a market closes.
 *
 * FX rates remain the exception in the other direction: they already have a full write path with
 * audited history on their own screen, so they are DISPLAYED here and edited there. Duplicating
 * the editor would create two ways to change the number that prices every booking.
 */
export const dynamic = 'force-dynamic';

/**
 * The design's `grid-template-columns` for the cities table, plus a track for the editor.
 *
 * The sixth was missing when the trigger was added, and a five-track grid given six columns does
 * not overflow — it SQUEEZES, so «البتراء» rendered as «تراء» and the last column was 40px wide.
 * Invisible to a type checker and to every HTTP-level check; the screenshot is what showed it.
 */
const TEMPLATE = '1.1fr .8fr .9fr .6fr .7fr .6fr 1.1fr';

export default async function GeoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
    FIRST, before any fetch.

    `staffFetch` maps a 403 to 'unauthenticated', so a guard placed after the fetches never
    runs: the page has already rendered «انتهت الجلسة» to somebody whose session is fine, and
    signing in again lands them here again.
  */
  const refused = await refuseSection('geo', t.nav.geo);

  if (refused) return refused;

  const { q, size } = await listParams(searchParams);

  const [result, categoryResult, counts] = await Promise.all([
    getGeography(q),
    getCityCategories(),
    sidebarCounts(),
  ]);

  /*
    The ACTIVE categories, for the pickers.

    A retired one still labels the cities already filed under it — that is what retiring means —
    but it must not be offered as a new choice. A failed read leaves the pickers empty rather than
    the screen broken: a console that refused to render a table because it could not list
    categories would be worse than one that cannot classify a city this minute.
  */
  const categories =
    categoryResult === 'failed' || categoryResult === 'unauthenticated'
      ? []
      : categoryResult.categories
          .filter((one) => one.isActive)
          .map((one) => ({ code: one.code, nameAr: one.nameAr }));

  /*
    The media host if one is configured, and the API's development route otherwise — `mediaBase`
    owns that choice, and reading `NEXT_PUBLIC_MEDIA_URL` here would be a second opinion on it.
  */
  /*
    ONE instant for the whole render, so the timezone pickers agree.

    Read here rather than inside the components: a `new Date()` per component renders one offset on
    the server and possibly another on the client, which is a hydration mismatch that shows up
    twice a year and never in a test.
  */
  const now = new Date();

  const media = mediaBase({
    NEXT_PUBLIC_MEDIA_URL: process.env['NEXT_PUBLIC_MEDIA_URL'],
    API_URL: process.env['API_URL'],
  });

  return (
    <ConsoleShell title={t.nav.geo} counts={counts}>
      {result === 'unauthenticated' ? (
        <ConsolePanel>
          <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
        </ConsolePanel>
      ) : result === 'failed' ? (
        <ConsolePanel>
          <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
        </ConsolePanel>
      ) : (
        <div className="grid gap-4">
          {/* Two cards side by side, as the design lays them out. */}
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <Countries
              rows={result.countries}
              currencies={result.currencies.map((one) => one.code)}
            />
            <Currencies rows={result.currencies} />
          </div>

          <ConsolePanel>
            {/*
              The form owns this row — see `AddForm`. It rendered inside an `ms-auto` wrapper
              first, which sizes to its content, so an eight-field form came out 230px wide
              against the edge of an otherwise empty panel.
            */}
            <AddCity
              title={t.sections.geo.cities}
              countries={result.countries.map((one) => one.code)}
              categories={categories}
              now={now}
            />

            <TableToolbar
              action="/geo"
              query={q}
              size={size}
              placeholder={t.sections.geo.searchPlaceholder}
            />

            <GeoCities
              cities={result.cities.map((row) => ({
                slug: row.slug,
                nameAr: row.nameAr,
                nameEn: row.nameEn,
                nameDe: row.nameDe,
                timezone: row.timezone,
                categories: row.categories,
                isActive: row.isActive,
                properties: row.properties,
                sortOrder: row.sortOrder,
                countryActive: row.countryActive,
                images: row.images,
                /* Null when the city has no photograph — never a guessed address. */
                heroUrl:
                  row.heroKey && row.heroWidths
                    ? mediaUrl(
                        media,
                        { fileKey: row.heroKey, variantWidths: row.heroWidths },
                        400,
                        'webp',
                      )
                    : null,
                /*
                  Each photograph's own address, built HERE for the same reason the hero's is: the
                  media base differs per environment and the pipeline never upscales, so only a
                  server that has read the configuration can turn a key into a URL.
                */
                photographs: row.photographs.map((one) => ({
                  id: one.id,
                  url: mediaUrl(
                    media,
                    { fileKey: one.fileKey, variantWidths: one.variantWidths },
                    400,
                    'webp',
                  ),
                  altAr: one.altAr,
                  altEn: one.altEn,
                  altDe: one.altDe,
                  credit: one.credit,
                  isHero: one.isHero,
                  sortOrder: one.sortOrder,
                })),
                descriptionAr: row.descriptionAr,
                descriptionEn: row.descriptionEn,
                descriptionDe: row.descriptionDe,
                tagsAr: row.tagsAr,
                tagsEn: row.tagsEn,
                tagsDe: row.tagsDe,
                country: row.country,
                category: row.category,
              }))}
              categories={categories}
              template={TEMPLATE}
              now={now}
            />

            <FootNote>{t.sections.geo.citiesNote}</FootNote>
          </ConsolePanel>
        </div>
      )}
    </ConsoleShell>
  );
}

function Countries({
  rows,
  currencies,
}: {
  rows: Geography['countries'];
  currencies: readonly string[];
}) {
  return (
    <ConsolePanel>
      <AddCountry title={t.sections.geo.countries} currencies={currencies} />

      {/* Each row opens its own editor — the writes that had no caller until 2026-08-30. */}
      <CountryRows rows={rows} currencies={currencies} />
    </ConsolePanel>
  );
}

function Currencies({ rows }: { rows: Geography['currencies'] }) {
  return (
    <ConsolePanel>
      <AddCurrency
        title={t.sections.geo.currencies}
        existing={rows.map((one) => one.code)}
      />

      <CurrencyRows rows={rows} />

      <FootNote>{t.sections.geo.note}</FootNote>
      <p className="mt-1 text-[11px] text-faint">
        <Link
          href="/settings"
          className="inline-flex min-h-10 items-center lg:min-h-0 text-sky hover:underline"
        >
          {t.sections.geo.fxElsewhere}
        </Link>
      </p>
    </ConsolePanel>
  );
}
