import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getReviewForBooking } from '@/lib/account';
import { ReviewForm } from '@/components/review-form';
import { isLocale } from '@/i18n/routing';

/**
 * Writing about a stay (§7.3, P-006).
 *
 * ## Why this is behind the account and not on the booking page
 *
 * `/booking/[reference]` is the post-payment holding page and deliberately looks nothing up: a
 * reference alone must not reveal a booking's details to whoever guesses one, and references are
 * sequential (§13.2). This page reads the booking through the OWNERSHIP-scoped API, so it can only
 * ever show a stay to the person who took it.
 *
 * A booking that is not the caller's answers 404 at the API, indistinguishably from one that does
 * not exist — so this renders not-found for both, and a reference cannot be probed.
 *
 * ## Every state has its own sentence
 *
 * Eligible gets the form; a stay still running gets "after your stay"; one already reviewed shows
 * the review, including when SAFRA has hidden it. That last case matters: hiding a review from its
 * own author would leave them unable to tell "it was removed" from "it never saved", and the
 * second reading produces a duplicate attempt the unique index then refuses.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ locale: string; reference: string }>;
}) {
  const { locale, reference } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('reviews');
  const account = await getTranslations('account');
  const eligibility = await getReviewForBooking(reference);

  if (eligibility === 'unauthenticated') {
    return (
      <Shell title={t('title')} locale={locale} back={account('title')}>
        <p className="text-muted">{account('sessionExpired')}</p>
      </Shell>
    );
  }

  /* Unknown, or somebody else's. The two are the same answer — see the note above. */
  if (eligibility === 'failed') notFound();

  return (
    <Shell title={t('title')} locale={locale} back={t('backToAccount')}>
      <p className="text-muted">
        {t('prompt', { property: eligibility.propertyName ?? '' })}
      </p>
      <p className="mt-1 text-sm text-faint">{eligibility.unitName}</p>

      {eligibility.review ? (
        <section className="mt-5 rounded-card border border-line bg-card p-4">
          <p className="text-xs text-faint">{t('yourReview')}</p>
          <p className="mt-1 text-lg font-bold text-gold" dir="ltr">
            <span aria-hidden>★</span> {eligibility.review.rating}
          </p>
          <p className="mt-2 leading-relaxed text-text">{eligibility.review.body}</p>

          {eligibility.review.status === 'hidden' ? (
            <p className="mt-3 rounded-lg border border-dashed border-bad/40 px-3 py-2 text-xs leading-relaxed text-faint">
              {t('hidden')}
            </p>
          ) : null}

          {eligibility.review.partnerReply ? (
            <div className="mt-3 rounded-lg border border-gold/30 bg-gold/5 px-3 py-2">
              <p className="text-xs font-bold text-gold">{t('partnerReply')}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                {eligibility.review.partnerReply}
              </p>
            </div>
          ) : null}
        </section>
      ) : eligibility.stayCompleted ? (
        <ReviewForm bookingReference={reference} locale={locale} />
      ) : (
        <p className="mt-5 rounded-card border border-line bg-card p-4 text-sm text-muted">
          {t('notCompleted')}
        </p>
      )}
    </Shell>
  );
}

function Shell({
  title,
  locale,
  back,
  children,
}: {
  readonly title: string;
  readonly locale: string;
  readonly back: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="font-display text-2xl font-bold text-gold">{title}</h1>
      {children}
      <Link
        href={`/${locale}/account`}
        className="mt-6 inline-flex min-h-10 items-center text-sm text-muted underline-offset-4 hover:text-gold hover:underline"
      >
        {back}
      </Link>
    </div>
  );
}
