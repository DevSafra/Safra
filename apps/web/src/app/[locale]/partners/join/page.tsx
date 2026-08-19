import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PartnerApplicationForm } from '@/components/partner-application-form';
import { isLocale } from '@/i18n/routing';
import { requireSignedIn } from '@/lib/account-page';
import { getCities, getPartnerTypes } from '@/lib/catalog';
import { localisedName } from '@/lib/localise';

/**
 * «انضم كشريك» — the page a prospective partner reads, and the form they fill in.
 *
 * ## Information first, form second
 *
 * Bashar asked for "information and a form" (2026-08-19), in that order, and the order is the
 * point. Somebody deciding whether to list a building wants to know what they are agreeing to
 * before they type their legal name into anything: what SAFRA does, what the seven steps are, what
 * documents will be asked for, and — the question every host actually has — when they can start
 * setting prices.
 *
 * The seven steps are written out because the flow is genuinely slower than a sign-up form, and an
 * applicant who does not know a phone call is coming reads the silence as rejection.
 *
 * ## Signed in only (Bashar, 2026-08-19)
 *
 * An anonymous visitor is sent to sign in with this page as their destination. The request is
 * filed AGAINST the account — that is where the address, and the account that becomes a partner,
 * both come from — so there is nothing for a visitor without one to submit.
 *
 * Guarded twice: the middleware refuses the route, and the page asks again. The middleware is a
 * matcher pattern and this page reads who you are; a page that depends on a pattern staying
 * correct is the reasoning `requireAccount` already records for eight other screens.
 *
 * ## What this page does NOT do
 *
 * It does not create an account, it does not ask for a password, and it does not ask for an email
 * address. The first two used to happen here in effect — `POST /partner/register` created a
 * partner outright — and the third stopped being a question the moment a session was required.
 *
 * ## Rendered per request, never statically
 *
 * It depends on who is asking, so there is no `generateStaticParams` and no `revalidate`. The
 * cities and business kinds are still cached inside `getCities`/`getPartnerTypes`.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'partner' });

  return { title: t('title'), description: t('subtitle') };
}

export default async function JoinAsPartnerPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: requested } = await params;
  /* A LITERAL path, never one from the URL — see the note on `requireSignedIn`. */
  const { session, locale } = await requireSignedIn(requested, '/partners/join');

  const t = await getTranslations('partner');

  /* Two independent reference reads should not serialise. */
  const [cities, partnerTypes] = await Promise.all([getCities(), getPartnerTypes()]);

  const steps = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'] as const;
  const reasons = ['audience', 'payouts', 'control', 'support'] as const;
  const documents = ['identity', 'register', 'ownership'] as const;

  return (
    <main className="mx-auto grid max-w-3xl gap-10 px-4 py-10">
      <header>
        <h1 className="text-3xl font-extrabold text-gold">{t('title')}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-text">{t('subtitle')}</p>
        <p className="mt-3 text-[14px] leading-relaxed text-muted">{t('intro')}</p>
      </header>

      <section>
        <h2 className="mb-3 text-xl font-bold text-text">{t('whyTitle')}</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {reasons.map((key) => (
            <li
              key={key}
              className="rounded-xl border border-line bg-card px-4 py-3 text-[13.5px] leading-relaxed text-text2"
            >
              {t(`why.${key}`)}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-text">{t('stepsTitle')}</h2>
        {/*
          An ordered list, so the numbers are the browser's own.

          Written out rather than rendered as digits in the markup: `<ol>` numbers according to the
          document's language, which is what keeps «١» from appearing in a German list — and the
          numerals themselves never become copy that a translator has to carry.
        */}
        <ol className="grid list-inside list-decimal gap-2 marker:font-bold marker:text-gold">
          {steps.map((key) => (
            <li
              key={key}
              className="rounded-xl border border-line bg-card px-4 py-3 text-[13.5px] leading-relaxed text-text2"
            >
              {t(`steps.${key}`)}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-text">{t('documentsTitle')}</h2>
        <ul className="grid gap-2">
          {documents.map((key) => (
            <li key={key} className="text-[13.5px] leading-relaxed text-text2">
              — {t(`documents.${key}`)}
            </li>
          ))}
        </ul>
        {/*
          Said here because it is the question that produces an email otherwise: nothing is
          uploaded from this page, and an applicant who attaches a passport to a public form has
          been let down by the page rather than by themselves.
        */}
        <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-3 text-[12.5px] leading-relaxed text-faint">
          {t('documentsNote')}
        </p>
      </section>

      <section>
        <h2 className="mb-1 text-xl font-bold text-text">{t('formTitle')}</h2>
        <p className="mb-1 text-[12.5px] text-faint">{t('formNote')}</p>
        {/* Why there is no email box, said where somebody would look for one. */}
        <p className="mb-4 text-[12.5px] text-faint">{t('signedInNote')}</p>

        <PartnerApplicationForm
          locale={locale}
          email={session.user.email}
          cities={cities.map((city) => ({
            value: city.slug,
            label: localisedName(city, locale),
          }))}
          partnerTypes={partnerTypes.map((type) => ({
            value: type.code,
            label: localisedName(type, locale),
          }))}
        />
      </section>
    </main>
  );
}
