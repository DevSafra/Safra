import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { isLocale } from '@/i18n/routing';
import { ltrIsolate } from '@/lib/bidi';

/**
 * تواصل معنا — how to reach SAFRA.
 *
 * ## The details on this page are PLACEHOLDERS, and that is recorded rather than hidden
 *
 * Bashar asked for the navbar item and, told that no support address, telephone, postal address or
 * WhatsApp number is stored anywhere in the platform, said «set random details for now»
 * (2026-09-27). So they are set — and they are set so that nobody can mistake them for real:
 *
 * - The address is on **`safra.example`**, which is the reserved TLD from RFC 2606 and the domain
 *   this codebase already uses for `MAIL_FROM`. It can never belong to anybody.
 * - The telephone is **all zeros** after the dialling code. A plausible-looking number is worse
 *   than an obviously fake one: it is somebody's telephone, and a customer with a booking problem
 *   would ring a stranger at midnight.
 *
 * `docs/FUTURE-WORK.md` carries this as work that must close before launch. **Do not ship this
 * page with these values.**
 *
 * ## الدعم is on it, and that part is real
 *
 * A signed-in customer already has a working channel — a support ticket lands in the console's
 * three-party inbox, which staff read. That is the one thing on this page that actually reaches
 * somebody today, so it is given its own place rather than buried under the placeholders.
 *
 * ## No form
 *
 * A public enquiry form is an unauthenticated write: it needs rate limiting, a spam story and a
 * decision about what a stranger may attach. It was offered as an option and not chosen, so it is
 * not half-built here.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'contact' });

  /*
    Not indexed while the details are placeholders. A contact page in a search result is what
    somebody with an urgent problem clicks, and these values would send them nowhere.
  */
  return { title: t('title'), description: t('subtitle'), robots: { index: false } };
}

export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const t = await getTranslations('contact');

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
      <h1 className="font-display text-3xl font-bold text-text sm:text-4xl">
        {t('title')}
      </h1>
      <p className="mt-3 max-w-[65ch] text-16 leading-relaxed text-muted">
        {t('subtitle')}
      </p>

      <dl className="mt-8 grid gap-4 sm:grid-cols-2">
        <Detail term={t('email')}>
          {/*
            A Latin RUN on a line of Arabic, so the VALUE is isolated and the label is not —
            wrapping the pair renders «البريد» after the address. The standing UI rule.
          */}
          <a
            href="mailto:info@safra.example"
            className="text-gold-read underline-offset-4 hover:underline"
          >
            {ltrIsolate('info@safra.example')}
          </a>
        </Detail>

        <Detail term={t('phone')}>
          <a
            href="tel:+963110000000"
            className="text-gold-read underline-offset-4 hover:underline"
          >
            {ltrIsolate('+963 11 000 0000')}
          </a>
        </Detail>

        <Detail term={t('address')}>{t('addressValue')}</Detail>
        <Detail term={t('hours')}>{t('hoursValue')}</Detail>
      </dl>

      {/*
        The channel that actually works today, given its own card rather than a line in the list
        above — it is the only one on this page that reaches a person.
      */}
      <section className="mt-8 rounded-card border border-gold/30 bg-card p-6">
        <h2 className="text-18 font-bold text-text">{t('supportTitle')}</h2>
        <p className="mt-2 max-w-[62ch] text-15 leading-relaxed text-muted">
          {t('supportBody')}
        </p>
        <Link
          href={`/${locale}/account/support`}
          className="mt-4 inline-flex min-h-11 items-center rounded-lg btn-gold px-5 text-15 font-bold"
        >
          {t('supportAction')}
        </Link>
      </section>
    </div>
  );
}

/** One fact, in the two-line shape the account screens use for the same job. */
function Detail({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-card p-4">
      <dt className="text-13 text-faint">{term}</dt>
      <dd className="mt-1 text-16 text-text">{children}</dd>
    </div>
  );
}
