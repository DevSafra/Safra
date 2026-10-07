import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { VerifyEmailConfirm } from '@/components/verify-email-confirm';
import { isLocale } from '@/i18n/routing';

/**
 * Confirming an email address (SRS §4).
 *
 * ## The page load does NOT confirm
 *
 * It used to, server-side while rendering, so that the click on the emailed link was the whole
 * interaction. The trade was written down as deliberate and it was wrong in the case that
 * matters: link-scanning proxies (Outlook Safe Links, corporate mail gateways) fetch EVERY link in an
 * incoming message, so the single-use token was spent before the customer saw the email, and the
 * customer's own click met «this link no longer works». That is not a minority to be traded away;
 * it is every customer whose employer filters mail, and they cannot sign in until the address is
 * confirmed.
 *
 * So the GET only checks the token's SHAPE and renders a button, and the button POSTs. A scanner
 * fetches and leaves; a person presses once. Validity stays the API's question, asked only then.
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

  /*
    A truncated or mangled link is said plainly now, before anybody presses anything — the same
    shape check the reset page makes, for the same reason.
  */
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return (
      <Shell>
        <h1 className="font-display text-2xl font-bold text-bad">
          {t('verifyFailedTitle')}
        </h1>
        <p className="mt-2 text-sm text-muted">{t('verifyFailed')}</p>
        {/*
          To sign-in, not to the account. An unverified customer cannot sign in (2026-10-06), so the
          account page would bounce them; the sign-in form is where a new link is offered.
        */}
        <Link
          href={`/${locale}/login`}
          className="mt-6 inline-block rounded-lg border border-line px-5 py-2.5 text-sm text-muted"
        >
          {t('backToSignIn')}
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <VerifyEmailConfirm locale={locale} token={token} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  /* Polite live region: the heading is replaced in place when the confirmation answers. */
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center" aria-live="polite">
      {children}
    </div>
  );
}
