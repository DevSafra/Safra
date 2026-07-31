import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PasswordResetForm } from '@/components/password-reset-form';
import { isLocale } from '@/i18n/routing';

/**
 * Choosing the new password (SRS §4).
 *
 * `noindex` and never cached. The URL carries a live credential in its query string,
 * so a crawler following it would consume the customer's only reset token, and a
 * cached render could serve one person's page to another.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
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

  const raw = query['token'];
  const token = Array.isArray(raw) ? raw[0] : raw;

  /**
   * The token's SHAPE is checked here, not its validity.
   *
   * Validity belongs to the API — it holds the digests — and asking it now would
   * consume the single-use token just to render a form. What this catches is a
   * truncated or mangled link, which is worth saying plainly rather than letting the
   * customer type a new password and only then be told the link was broken.
   */
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="font-display text-2xl text-bad">{t('resetLinkInvalidTitle')}</h1>
        <p className="mt-2 text-sm text-muted">{t('resetLinkInvalid')}</p>
        <Link
          href={`/${locale}/forgot-password`}
          className="mt-6 inline-block rounded-lg bg-gold px-5 py-2.5 font-semibold text-bg"
        >
          {t('requestNewLink')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-display text-3xl font-bold text-gold">{t('resetTitle')}</h1>
      <p className="mt-2 text-sm text-muted">{t('resetSubtitle')}</p>

      <div className="mt-8 rounded-card border border-line bg-card p-6">
        <PasswordResetForm locale={locale} mode="confirm" token={token} />
      </div>
    </div>
  );
}
