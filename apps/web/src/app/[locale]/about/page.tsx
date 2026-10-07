import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { PledgeCards } from '@/components/pledge-cards';
import { ServiceCards } from '@/components/service-cards';
import { isLocale } from '@/i18n/routing';
import { getPublicSettings } from '@/lib/catalog';
import { partnerApplicationsOpen } from '@safra/contracts';
import { localeAlternates } from '@/lib/alternates';

/**
 * «عن سفرة» (Bashar, 2026-10-04: «create a new page "عن سفرة" and add it to the navbar menu between
 * الرئيسية and تواصل معنا»).
 *
 * ## Every sentence on it is one SAFRA already publishes
 *
 * An «about» page is where a site states facts about itself, and facts nobody approved are the
 * thing not to invent. So the page is composed from approved copy: the footer's description of
 * SAFRA, the home page's promise, the three pledges, the six services and the partner offer. The
 * only new words are the page's name. When Bashar writes the company's own story it goes in the
 * opening, above what is here.
 *
 * The pledges and services are the SAME components as the home page, so a promise cannot read
 * one way here and another way there.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'about' });
  const footer = await getTranslations({ locale, namespace: 'footer' });

  return {
    title: t('title'),
    description: footer('about'),
    alternates: localeAlternates(locale, '/about'),
  };
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const t = await getTranslations('about');
  const home = await getTranslations('home');
  const footer = await getTranslations('footer');
  const nav = await getTranslations('nav');
  /* Closed on الإعدادات (2026-10-04), the partner offer below is not made at all. */
  const partnersOpen = partnerApplicationsOpen(await getPublicSettings());

  return (
    <>
      <section className="border-b border-line bg-[linear-gradient(var(--color-bg),var(--color-band))]">
        <div className="mx-auto max-w-4xl px-4 py-12 text-center sm:py-16">
          <h1 className="font-display text-3xl font-bold text-balance text-text sm:text-4xl">
            {t('title')}
          </h1>
          <p className="mx-auto mt-5 max-w-[62ch] text-17 leading-[1.8] text-text">
            {footer('about')}
          </p>
          <p className="mx-auto mt-3 max-w-[62ch] text-16 leading-relaxed text-muted">
            {home('heroPromiseLead')} {home('heroPromiseCare')}
          </p>
          <p className="mt-6 text-14 font-semibold text-gold-read">{footer('madeFor')}</p>
        </div>
      </section>

      <section aria-labelledby="about-pledges" className="bg-bg">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:py-14">
          <Heading id="about-pledges" lead={home('pledgesSubtitle')}>
            {home('pledgesTitle')}
          </Heading>
          <div className="mt-7">
            <PledgeCards
              pledges={[
                {
                  ordinal: home('pledgeOrdinal1'),
                  title: home('pledge1Title'),
                  body: home('pledge1Body'),
                },
                {
                  ordinal: home('pledgeOrdinal2'),
                  title: home('pledge2Title'),
                  body: home('pledge2Body'),
                },
                {
                  ordinal: home('pledgeOrdinal3'),
                  title: home('pledge3Title'),
                  body: home('pledge3Body'),
                },
              ]}
            />
          </div>
        </div>
      </section>

      {/*
        With the partner offer closed this is the last band, and it runs on through the footer's
        `mt-16` rather than leaving a strip of page background above the footer (2026-10-07).
      */}
      <section
        aria-labelledby="about-services"
        className={`bg-[linear-gradient(var(--color-bg),var(--color-bg2))] ${partnersOpen ? '' : '-mb-16 pb-16'}`}
      >
        <div className="mx-auto max-w-7xl px-4 py-12 sm:py-14">
          <Heading id="about-services">{home('services.label')}</Heading>
          <div className="mt-7">
            <ServiceCards
              locale={locale}
              copy={{
                names: {
                  rides: home('services.names.rides'),
                  stay: home('services.names.stay'),
                  medical: home('services.names.medical'),
                  trips: home('services.names.trips'),
                  umrah: home('services.names.umrah'),
                  realEstate: home('services.names.realEstate'),
                },
                covers: {
                  rides: home('services.covers.rides'),
                  stay: home('services.covers.stay'),
                  medical: home('services.covers.medical'),
                  trips: home('services.covers.trips'),
                  umrah: home('services.covers.umrah'),
                  realEstate: home('services.covers.realEstate'),
                },
                soon: home('services.soon'),
              }}
            />
          </div>
        </div>
      </section>

      {/*
        The two ways onward an about page owes its reader: list a property with SAFRA, or reach the
        people behind it. The partner offer is the home page's, without the commission rate, which
        lives in settings and is quoted where the page reads them.
      */}
      {partnersOpen ? (
        <section aria-labelledby="about-partners" className="bg-bg">
          <div className="mx-auto max-w-7xl px-4 pb-14 sm:pb-16">
            <div className="grid gap-6 rounded-card border border-line bg-card p-6 sm:p-7 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-12">
              <div>
                <h2
                  id="about-partners"
                  className="font-display text-26 leading-snug font-bold text-balance text-text sm:text-32"
                >
                  {home('partnersSubtitle')}
                </h2>
                <p className="mt-3 max-w-[62ch] text-16 leading-relaxed text-muted">
                  {home('partnersBodyNoRate')}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  href={`/${locale}/partners/join`}
                  className="btn-gold inline-flex min-h-12 items-center justify-center rounded-lg px-8 text-16 font-bold"
                >
                  {home('partnersCta')}
                </Link>
                <Link
                  href={`/${locale}/contact`}
                  className="inline-flex min-h-12 items-center justify-center rounded-lg border border-line px-6 text-16 font-semibold text-text transition-colors duration-200 ease-out-strong hover:border-gold/60 hover:text-gold-read"
                >
                  {nav('contact')}
                </Link>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}

function Heading({
  id,
  lead,
  children,
}: {
  readonly id: string;
  readonly lead?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="text-center">
      <h2
        id={id}
        className="font-display text-26 leading-snug font-bold text-balance text-text sm:text-32"
      >
        {children}
      </h2>
      {lead ? (
        <p className="mx-auto mt-2 max-w-[62ch] text-16 leading-relaxed text-muted">
          {lead}
        </p>
      ) : null}
    </div>
  );
}
