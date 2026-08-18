import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getReviewForBooking } from '@/lib/account';
import { ReviewForm } from '@/components/review-form';
import { BackLink } from '@/components/back-link';
import { isLocale, type Locale } from '@/i18n/routing';
import { localisedName } from '@/lib/localise';
import { returnTo } from '@/lib/return-to';

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
  searchParams,
}: {
  params: Promise<{ locale: string; reference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, reference } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  /*
    Back to the list the reader came from — تقييماتي or the overview.

    `reviews` is the fallback rather than the home page: this route IS behind the auth middleware, so
    whoever is reading it has an account, and the section that owns this stay is the useful place to
    land when there is no origin to honour.
  */
  const back = returnTo(locale, (await searchParams)['from'], 'reviews');

  const t = await getTranslations('reviews');
  const account = await getTranslations('account');
  const eligibility = await getReviewForBooking(reference);

  if (eligibility === 'unauthenticated') {
    return (
      <Shell title={t('title')} locale={locale} back={back}>
        <p className="text-muted">{account('sessionExpired')}</p>
      </Shell>
    );
  }

  /* Unknown, or somebody else's. The two are the same answer — see the note above. */
  if (eligibility === 'failed') notFound();

  return (
    <Shell title={t('title')} locale={locale} back={back}>
      <p className="text-muted">
        {t('prompt', { property: localisedName(eligibility.property, locale) })}
      </p>
      <p className="mt-1 text-sm text-faint">{localisedName(eligibility.unit, locale)}</p>

      {eligibility.review ? (
        <section className="mt-5 rounded-card border border-line bg-card p-4">
          <p className="text-xs text-faint">{t('yourReview')}</p>
          {/*
            The `dir` moved from the <p> to an inline <span>.

            On the BLOCK it also moved the element's start edge, so «★ 4.7» sat at the far end of
            the card away from its label — the same fault as the receipt's date. On an inline run it
            fixes the ORDER, which is all the star needs, and leaves the alignment to the document.
            The star keeps its own `aria-hidden`: it is decoration beside a number that is read out.
          */}
          <p className="mt-1 text-lg font-bold text-gold">
            <span dir="ltr">
              <span aria-hidden>★</span> {eligibility.review.rating}
            </span>
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
  readonly locale: Locale;
  /** An href from the `returnTo` allow-list, not a label — the control names itself. */
  readonly back: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="font-display text-2xl font-bold text-gold">{title}</h1>
      {children}
      <div className="mt-6">
        <BackLink href={back} locale={locale} />
      </div>
    </div>
  );
}
