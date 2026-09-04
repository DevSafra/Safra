import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { dialOptions } from '@/lib/dial-options';
import { AuthForm } from '@/components/auth-form';
import { isLocale } from '@/i18n/routing';
import { getSession } from '@/lib/session-server';
import { safeRedirect } from '@safra/session';

/** Create an account (SRS §4). Dynamic and noindex, for the same reasons as login. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function RegisterPage({
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

  if (await getSession()) redirect(next);

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-display text-3xl font-bold text-gold">{t('registerTitle')}</h1>
      <p className="mt-2 text-sm text-muted">{t('registerSubtitle')}</p>

      <div className="mt-8 rounded-card border border-line bg-card p-6">
        <AuthForm
          countries={dialOptions(locale)}
          locale={locale}
          mode="register"
          redirectTo={next}
        />
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        {t('haveAccount')}{' '}
        <Link
          href={`/${locale}/login?next=${encodeURIComponent(next)}`}
          className="inline-flex min-h-10 items-center lg:min-h-0 text-gold hover:underline"
        >
          {t('signIn')}
        </Link>
      </p>
    </div>
  );
}
