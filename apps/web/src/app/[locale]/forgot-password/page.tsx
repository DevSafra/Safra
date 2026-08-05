import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PasswordResetForm } from '@/components/password-reset-form';
import { isLocale } from '@/i18n/routing';

/** Requesting a reset link (SRS §4). */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('auth');

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-display text-3xl font-bold text-gold">{t('forgotTitle')}</h1>
      <p className="mt-2 text-sm text-muted">{t('forgotSubtitle')}</p>

      <div className="mt-8 rounded-card border border-line bg-card p-6">
        <PasswordResetForm locale={locale} mode="request" />
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        <Link
          href={`/${locale}/login`}
          className="inline-flex min-h-10 items-center lg:min-h-0 text-gold hover:underline"
        >
          {t('backToSignIn')}
        </Link>
      </p>
    </div>
  );
}
