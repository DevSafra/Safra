import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { isLocale } from '@/i18n/routing';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Confirming an email address (SRS §4).
 *
 * The confirmation happens server-side while rendering, so the customer's click on
 * the emailed link is the whole interaction — no second button to press.
 *
 * That does mean a link-scanning proxy in a corporate mail system can consume the
 * token before the customer sees it. The trade is deliberate: the alternative is an
 * extra click for every customer to protect a minority whose scanner would follow
 * the second link too. A consumed token shows the "already confirmed or expired"
 * state, from which they can request another.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage({
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

  const outcome =
    token && /^[A-Za-z0-9_-]{43}$/.test(token) ? await confirm(token) : 'invalid';

  if (outcome === 'invalid') {
    return (
      <Shell title={t('verifyFailedTitle')} tone="bad">
        <p className="mt-2 text-sm text-muted">{t('verifyFailed')}</p>
        <Link
          href={`/${locale}/account`}
          className="mt-6 inline-block rounded-lg border border-line px-5 py-2.5 text-sm text-muted"
        >
          {t('account')}
        </Link>
      </Shell>
    );
  }

  return (
    <Shell title={t('verifiedTitle')} tone="good">
      <p className="mt-2 text-sm text-muted">{t('verified')}</p>

      {/*
        Only mentioned when it actually happened. Telling every customer "we linked
        your previous bookings" when there were none is noise at best and confusing
        at worst.
      */}
      {outcome.claimedBookings > 0 ? (
        <p className="mt-3 rounded-lg border border-gold/30 bg-gold/5 p-3 text-sm text-gold-ink">
          {t('claimedBookings', { count: outcome.claimedBookings })}
        </p>
      ) : null}

      <Link
        href={`/${locale}/account`}
        className="mt-6 inline-block rounded-lg btn-gold px-5 py-2.5 font-semibold"
      >
        {t('account')}
      </Link>
    </Shell>
  );
}

async function confirm(token: string): Promise<{ claimedBookings: number } | 'invalid'> {
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/email/verify/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    });

    if (!response.ok) return 'invalid';

    const body: unknown = await response.json().catch(() => null);

    if (typeof body !== 'object' || body === null || !('claimedBookings' in body)) {
      return { claimedBookings: 0 };
    }

    const claimed = Number(body.claimedBookings);

    return { claimedBookings: Number.isFinite(claimed) ? claimed : 0 };
  } catch {
    return 'invalid';
  }
}

function Shell({
  title,
  tone,
  children,
}: {
  title: string;
  tone: 'good' | 'bad';
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1
        className={`font-display text-2xl ${tone === 'good' ? 'text-gold' : 'text-bad'}`}
      >
        {title}
      </h1>
      {children}
    </div>
  );
}
