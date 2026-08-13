import type { Metadata } from 'next';
import { Amiri, Cairo } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { LOCALE_DIRECTION, isLocale, routing } from '@/i18n/routing';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { ThemeScript } from '@/components/theme-script';

import '../globals.css';

/**
 * Amiri for display — the Arabic serif the approved prototype embedded, which
 * carries the "oriental character" §1.1 calls for. Cairo for UI text, because a
 * serif at 14px in Arabic is hard to read on screen.
 *
 * Both are self-hosted by next/font at build time: no runtime request to Google,
 * no layout shift, and nothing for a visitor's network to block.
 */
const amiri = Amiri({
  subsets: ['arabic', 'latin'],
  weight: ['400', '700'],
  variable: '--font-amiri',
  display: 'swap',
});

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  variable: '--font-cairo',
  display: 'swap',
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'brand' });
  const home = await getTranslations({ locale, namespace: 'home' });

  const title = `${t('name')} | ${t('latin')}`;

  return {
    title: { default: title, template: `%s · ${t('name')}` },
    description: home('heroPromise'),
    // §5.4 targets SEO, so each page declares its language alternates explicitly
    // rather than relying on a crawler to infer them.
    alternates: {
      languages: Object.fromEntries(routing.locales.map((l) => [l, `/${l}`])),
    },
    openGraph: {
      title,
      description: home('heroSubtitle'),
      locale,
      type: 'website',
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  // Enables static rendering for this locale's pages.
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'common' });
  const direction = LOCALE_DIRECTION[locale];

  return (
    <html lang={locale} dir={direction} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body
        className={`${amiri.variable} ${cairo.variable} flex min-h-dvh flex-col bg-bg text-text`}
      >
        <NextIntlClientProvider>
          {/* Keyboard users must be able to bypass the header on every page. */}
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-50 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:text-gold"
          >
            {t('skipToContent')}
          </a>
          <SiteHeader locale={locale} />
          {/*
            `flex-1` on the main, so a short page — a 404, a confirmation — still pushes the footer
            to the bottom of the viewport instead of leaving it floating halfway up with dead space
            beneath it. The body is the flex column that makes that work.
          */}
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter locale={locale} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
