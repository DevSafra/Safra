'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import type { Locale } from '@/i18n/routing';

type Outcome =
  | { kind: 'ready' }
  | { kind: 'verified'; claimedBookings: number }
  | { kind: 'failed' }
  /* Retryable: the token was NOT spent, so the same button can be pressed again. */
  | { kind: 'retry'; message: string };

/**
 * The button that confirms an email address, and the three answers it can get.
 *
 * ## Why a button at all
 *
 * The link in the email used to confirm on page load, and mail scanners load every link — so the
 * single-use token was spent by Outlook Safe Links before the person clicked, and they met «this
 * link no longer works» on a link they had never opened. A scanner fetches; it does not press. The
 * cost is one click for the person, on a page that says what the click does.
 *
 * One component, because the heading changes with the answer: «تأكيد بريدك الإلكتروني» becomes
 * «تم تأكيد البريد الإلكتروني» in place, rather than a navigation to a result page whose state a
 * crafted URL could fake.
 */
export function VerifyEmailConfirm({ locale, token }: { locale: Locale; token: string }) {
  const t = useTranslations('auth');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'ready' });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);

    try {
      const response = await fetch(`/${locale}/api/auth/verify-email/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (response.ok) {
        setOutcome({ kind: 'verified', claimedBookings: await claimedFrom(response) });
      } else if (response.status === 400) {
        /* Expired, already used, or malformed: the API's one answer for a token it will not take. */
        setOutcome({ kind: 'failed' });
      } else {
        setOutcome({
          kind: 'retry',
          message: response.status === 429 ? t('tooManyAttempts') : t('genericError'),
        });
      }
    } catch {
      setOutcome({ kind: 'retry', message: t('networkError') });
    } finally {
      setSubmitting(false);
    }
  }

  if (outcome.kind === 'verified') {
    return (
      <>
        <h1 className="font-display text-2xl font-bold text-gold">
          {t('verifiedTitle')}
        </h1>
        <p className="mt-2 text-sm text-muted">{t('verified')}</p>

        {/*
          Only mentioned when it actually happened. Telling every customer "we linked your previous
          bookings" when there were none is noise at best and confusing at worst.
        */}
        {outcome.claimedBookings > 0 ? (
          <p className="mt-3 rounded-lg border border-gold/30 bg-gold/5 p-3 text-sm text-gold-read">
            {t('claimedBookings', { count: outcome.claimedBookings })}
          </p>
        ) : null}

        <Link
          href={`/${locale}/account`}
          className="mt-6 inline-block rounded-lg btn-gold px-5 py-2.5 font-semibold"
        >
          {t('account')}
        </Link>
      </>
    );
  }

  if (outcome.kind === 'failed') {
    return (
      <>
        <h1 className="font-display text-2xl font-bold text-bad">
          {t('verifyFailedTitle')}
        </h1>
        <p className="mt-2 text-sm text-muted">{t('verifyFailed')}</p>
        {/*
          To sign-in, not to the account. An unverified customer cannot sign in, so the account
          page would bounce them; the sign-in form is where a new link is offered.
        */}
        <Link
          href={`/${locale}/login`}
          className="mt-6 inline-block rounded-lg border border-line px-5 py-2.5 text-sm text-muted"
        >
          {t('backToSignIn')}
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="font-display text-2xl font-bold text-gold">
        {t('verifyConfirmTitle')}
      </h1>
      <p className="mt-2 text-sm text-muted">{t('verifyConfirmBody')}</p>

      {/*
        `method="post"`, so a submit before hydration does not become a GET carrying the token in a
        second URL — see the same attribute on `PasswordResetForm`. Without JavaScript the page is
        simply rendered again, and the token is still unspent.
      */}
      <form method="post" onSubmit={(event) => void handleSubmit(event)} className="mt-6">
        {outcome.kind === 'retry' ? (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
          >
            {outcome.message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className="inline-block cursor-pointer rounded-lg btn-gold px-5 py-2.5 font-semibold disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? t('submitting') : t('verifyConfirmButton')}
        </button>
      </form>
    </>
  );
}

async function claimedFrom(response: Response): Promise<number> {
  const body: unknown = await response.json().catch(() => null);

  if (typeof body !== 'object' || body === null || !('claimedBookings' in body)) return 0;

  const claimed = Number(body.claimedBookings);

  return Number.isFinite(claimed) ? claimed : 0;
}
