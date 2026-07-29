import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { SearchForm } from '@/components/search-form';
import { isLocale } from '@/i18n/routing';
import { getCities, getPropertyTypes, getPublicSettings } from '@/lib/catalog';
import { formatCustomerFee, todayInDamascus } from '@/lib/settings';
import { localisedName } from '@/lib/localise';

export const revalidate = 300;

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('home');
  const tc = await getTranslations('cityCategories');
  const tt = await getTranslations('propertyTypes');

  // Fetched in parallel: three independent reference reads should not serialise.
  const [cities, propertyTypes, settings] = await Promise.all([
    getCities(),
    getPropertyTypes(),
    getPublicSettings(),
  ]);

  return (
    <>
      {/* ── Hero + search (§5.1) ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-line">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklab,var(--color-sky)_18%,transparent),transparent_60%)]"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <p className="text-sm tracking-wide text-sky">{t('heroCountries')}</p>
          <h1 className="mt-3 max-w-3xl font-display text-4xl leading-tight font-bold text-gold sm:text-5xl">
            {t('heroTitle')}
          </h1>
          <p className="mt-3 max-w-2xl text-lg text-muted">{t('heroSubtitle')}</p>
          <p className="mt-2 max-w-2xl text-sm text-faint">{t('heroPromise')}</p>

          <div className="mt-8">
            <SearchForm locale={locale} cities={cities} minDate={todayInDamascus()} />
          </div>

          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
            {[t('trustVerified'), t('trustPayment'), t('trustCompensation')].map(
              (item) => (
                <li key={item} className="flex items-center gap-2">
                  <span aria-hidden className="text-gold">
                    ✦
                  </span>
                  {item}
                </li>
              ),
            )}
          </ul>
        </div>
      </section>

      {/* ── Destinations (§5.4 entry points) ─────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <SectionHeading
          title={t('destinationsTitle')}
          subtitle={t('destinationsSubtitle')}
        />
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cities.map((city) => (
            <li key={city.slug}>
              <Link
                href={`/${locale}/city/${city.slug}`}
                className="group flex h-full flex-col justify-between rounded-card border border-line bg-card p-5 transition-colors hover:border-gold/60"
              >
                <div>
                  <h3 className="font-display text-xl text-text group-hover:text-gold">
                    {localisedName(city, locale)}
                  </h3>
                  <p className="mt-1 text-sm text-faint">
                    {city.categories.map((category) => tc(category)).join(' · ')}
                  </p>
                </div>
                <p className="mt-4 text-sm text-muted">
                  {city.propertyCount > 0
                    ? `${city.propertyCount} · ${city.countryCode}`
                    : city.countryCode}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Types of stay (§8.2) ─────────────────────────────────────────── */}
      <section className="border-y border-line bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <SectionHeading title={t('typesTitle')} subtitle={t('typesSubtitle')} />
          <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {propertyTypes.map((type) => (
              <li key={type.code}>
                <Link
                  href={`/${locale}/search?propertyTypeCode=${type.code}&checkIn=${todayInDamascus()}&checkOut=${tomorrowInDamascus()}&adults=2`}
                  className="flex h-full flex-col items-center gap-2 rounded-card border border-line bg-card p-4 text-center transition-colors hover:border-gold/60"
                >
                  <span aria-hidden className="text-2xl">
                    {type.glyph ?? '✦'}
                  </span>
                  <span className="text-sm text-text">{tt(type.code)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── How booking works (§6.1) ─────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <SectionHeading title={t('howTitle')} subtitle={t('howSubtitle')} />
        <p className="mt-6 max-w-3xl text-muted">{t('howBody')}</p>
      </section>

      {/* ── The three pledges (P-001, P-002, P-007) ──────────────────────── */}
      <section className="border-t border-line bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <SectionHeading title={t('pledgesTitle')} subtitle={t('pledgesSubtitle')} />
          <ul className="mt-8 grid gap-5 md:grid-cols-3">
            {[
              { glyph: '☾', title: t('pledge1Title'), body: t('pledge1Body') },
              { glyph: '✦', title: t('pledge2Title'), body: t('pledge2Body') },
              { glyph: '۞', title: t('pledge3Title'), body: t('pledge3Body') },
            ].map((pledge) => (
              <li
                key={pledge.title}
                className="rounded-card border border-line bg-card p-6 text-center"
              >
                <span aria-hidden className="text-2xl text-gold">
                  {pledge.glyph}
                </span>
                <h3 className="mt-3 font-display text-lg text-text">{pledge.title}</h3>
                <div className="gold-rule my-4" />
                <p className="text-sm text-muted">{pledge.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Partner recruitment (§8.3) ───────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="rounded-card border border-gold/30 bg-card p-8">
          <SectionHeading title={t('partnersTitle')} subtitle={t('partnersSubtitle')} />
          <p className="mt-4 max-w-2xl text-muted">
            {/*
              The commission comes from settings, never a hardcoded string. The super
              admin edits it from the Rules Engine page (P-005), and this text has to
              follow whatever they set.
            */}
            {t('partnersBody', {
              rate: formatCustomerFee(settings, 'partnerRate', locale),
            })}
          </p>
          <Link
            href={`/${locale}/partner`}
            className="mt-6 inline-block rounded-lg bg-gold px-5 py-2.5 font-semibold text-bg transition-opacity hover:opacity-90"
          >
            {t('partnersCta')}
          </Link>
        </div>
      </section>
    </>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <p className="text-sm tracking-wide text-gold">{title}</p>
      <h2 className="mt-1 font-display text-2xl text-text sm:text-3xl">{subtitle}</h2>
    </div>
  );
}

function tomorrowInDamascus(): string {
  const today = todayInDamascus();
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}
