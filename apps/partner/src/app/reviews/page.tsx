import { getMyProfile, getMyReviews, type PartnerReview, sidebarBadges } from '@/lib/api';
import { Shell } from '@/components/shell';
import { Ltr } from '@/components/ltr';
import { ReviewActions } from '@/components/review-actions';
import { count } from '@/lib/format';
import { fill, t } from '@/lib/strings';

/**
 * تقييمات ضيوفي (design handoff §7.3).
 *
 * ## P-006 is stated on the page, and true underneath it
 *
 * *"لا يمكن حذف تقييم — يمكنك الرد عليه أو الإبلاغ عنه"* is printed under the header, and there is
 * no delete control anywhere on this screen — not disabled, absent. The API exposes no such route
 * and the table refuses `DELETE` by trigger, so the sentence describes the system rather than
 * asking the reader to take it on trust.
 *
 * ## Hidden reviews stay on this screen
 *
 * A review SAFRA has hidden is shown here, marked, with the note explaining it is not counted in
 * the average. Removing it would leave the partner unable to tell "SAFRA acted on my report" from
 * "the review vanished", which is the state most likely to produce a second complaint about the
 * first.
 */
export const dynamic = 'force-dynamic';

/** One page. Reviews are read, not worked through, so the §7.3 list is a simple run. */
const PAGE_SIZE = 25;

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = Number(Array.isArray(params['page']) ? params['page'][0] : params['page']);
  /* Clamped rather than validated: a typed `?page=0` should show page one, not an error page. */
  const page = Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 100_000) : 1;

  const [profile, result] = await Promise.all([
    getMyProfile(),
    getMyReviews({ page, limit: PAGE_SIZE }),
  ]);

  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  return (
    <Shell
      title={t.reviews.title}
      partnerName={name}
      active="reviews"
      badges={sidebarBadges(profile)}
    >
      {result === 'unauthenticated' ? (
        <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
      ) : result === 'failed' ? (
        <p className="text-sm text-bad">{t.dashboard.loadFailed}</p>
      ) : (
        <div className="grid gap-3.5">
          <header className="grid gap-1">
            <p className="text-[13px] font-bold text-gold">
              {result.summary.average
                ? fill(t.reviews.summary, {
                    average: result.summary.average,
                    n: count(result.summary.published),
                  })
                : t.reviews.summaryEmpty}
            </p>
            {/* The rule, quoted. It is the reason there is no third button below. */}
            <p className="text-[11.5px] text-faint">{t.reviews.rule}</p>
          </header>

          {result.items.length === 0 ? (
            <p className="text-sm text-faint">{t.reviews.empty}</p>
          ) : (
            <ul className="grid gap-2.5">
              {result.items.map((review) => (
                <li key={review.reference}>
                  <Row review={review} />
                </li>
              ))}
            </ul>
          )}

          {result.pages > 1 ? (
            <nav
              aria-label={t.reviews.title}
              className="flex flex-wrap items-center gap-2 text-[12px] text-muted"
            >
              {page > 1 ? (
                <a
                  href={`/reviews?page=${page - 1}`}
                  className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 lg:min-h-0 lg:py-1.5"
                >
                  ›
                </a>
              ) : null}
              <span>
                <Ltr>
                  {count(result.page)} / {count(result.pages)}
                </Ltr>
              </span>
              {page < result.pages ? (
                <a
                  href={`/reviews?page=${page + 1}`}
                  className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 lg:min-h-0 lg:py-1.5"
                >
                  ‹
                </a>
              ) : null}
            </nav>
          ) : null}
        </div>
      )}
    </Shell>
  );
}

/** One review, laid out as §7.3 draws it. */
function Row({ review }: { readonly review: PartnerReview }) {
  const hidden = review.status === 'hidden';

  return (
    <article
      className={`rounded-xl border bg-field p-3.5 ${hidden ? 'border-bad/40 opacity-80' : 'border-line'}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[13px] font-bold text-text">{review.guestName}</span>
        <span className="text-[11.5px] font-semibold text-gold">
          {review.propertyName}
        </span>
        <span className="text-[11.5px] text-faint">{review.unitName}</span>
        <span className="text-[12.5px] font-extrabold text-gold">
          <Ltr>★ {review.rating}</Ltr>
        </span>

        {hidden ? (
          <span className="rounded-full border border-bad bg-bad/15 px-2 py-0.5 text-[10.5px] font-bold text-bad">
            {t.reviews.hidden}
          </span>
        ) : null}

        {/* The date is pushed to the far side — §7.3, verbatim. */}
        <span className="ms-auto text-[11.5px] text-faint">
          <Ltr>{review.createdAt.slice(0, 10)}</Ltr>
        </span>
      </div>

      <p className="mt-2 text-[12.5px] leading-[1.8] text-muted">{review.body}</p>

      {hidden ? (
        <p className="mt-2 rounded-lg border border-dashed border-bad/40 px-3 py-2 text-[11.5px] text-faint">
          {t.reviews.hiddenNote}
        </p>
      ) : null}

      {review.partnerReply ? (
        <div className="mt-2.5 rounded-lg border border-gold/30 bg-gold/5 px-3 py-2">
          <p className="text-[11px] font-bold text-gold">{t.reviews.replied}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            {review.partnerReply}
          </p>
        </div>
      ) : null}

      <ReviewActions
        reference={review.reference}
        hasReply={review.partnerReply !== null}
        reportStatus={review.reportStatus}
      />
    </article>
  );
}
