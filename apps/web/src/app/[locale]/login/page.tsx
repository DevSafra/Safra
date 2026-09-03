import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthForm } from '@/components/auth-form';
import { isLocale } from '@/i18n/routing';
import { getSession } from '@/lib/session-server';
import { safeRedirect } from '@safra/session';

/**
 * Sign in (SRS §4).
 *
 * Dynamic and `noindex`: it renders differently for a signed-in visitor, and a
 * cached copy served to the wrong person would be a session-shaped bug. There is
 * also nothing here worth crawling.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const query = await searchParams;
  const t = await getTranslations('auth');

  const next = safeRedirect(query['next'], locale);

  // Already signed in: go where they were headed rather than showing a form that
  // would only sign them in as themselves again.
  if (await getSession()) redirect(next);

  // Set by the reset flow, which lands here because a completed reset revokes every
  // session — including any this browser was holding.
  const justReset = query['reset'] === '1';

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-display text-3xl font-bold text-gold text-center">
        {t('signInTitle')}
      </h1>
      <p className="mt-2 text-sm text-muted text-center">{t('signInSubtitle')}</p>

      {justReset ? (
        <p className="mt-6 rounded-lg border border-ok/40 bg-ok/10 p-3 text-sm text-ok">
          {t('resetDone')}
        </p>
      ) : null}

      <div className="mt-8 rounded-card border border-line bg-card p-6">
        <AuthForm locale={locale} mode="login" redirectTo={next} />
      </div>

      <p className="mt-4 text-center text-sm">
        <Link
          href={`/${locale}/forgot-password`}
          className="inline-flex min-h-10 items-center lg:min-h-0 text-muted hover:text-gold hover:underline"
        >
          {t('forgotPassword')}
        </Link>
      </p>

      <p className="mt-6 text-center text-sm text-muted">
        {t('noAccount')}{' '}
        <Link
          href={`/${locale}/register?next=${encodeURIComponent(next)}`}
          className="inline-flex min-h-10 items-center lg:min-h-0 text-gold-ink hover:underline"
        >
          {t('createAccount')}
        </Link>
      </p>

      {/*
        §4 keeps guest checkout available, and saying so here matters: a customer who
        thinks an account is mandatory to book is a customer who leaves.
      */}
      <p className="mt-3 text-center text-xs text-faint">{t('guestNote')}</p>
    </div>
  );
}
