import { getReportedReviews } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { shortDateTime } from '@/lib/format';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { FootNote, Ltr } from '@/components/admin-table';
import { TablePagination } from '@/components/table-pagination';
import { ReviewModeration } from '@/components/review-moderation';
import { rowAnchor } from '@/lib/search-params';
import { t } from '@/lib/strings';
import { listParamsFor } from '@/lib/table-size';
import { refuseSection } from '@/components/section-refusal';

/**
 * التقييمات المُبلَّغ عنها — the moderation queue (§7.3, P-006).
 *
 * ## A list of cards, not a table
 *
 * The decision needs the review BODY and the partner's reason side by side, and neither fits a
 * column. "Table" means any paged list in this project, so it pages like every other registry —
 * see the standing pagination rule, which is explicit that the staff registry of cards is not an
 * exception.
 *
 * ## Reached from النزاعات, not the sidebar
 *
 * The handoff specifies nineteen sections and `navigation.spec.ts` sweeps exactly those. A
 * reported review is a complaint about a guest's words, which is the same queue النزاعات already
 * serves, so this lives beside it rather than becoming a twentieth entry.
 */
export const dynamic = 'force-dynamic';

export default async function ReviewModerationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
    FIRST, before any fetch.

    `staffFetch` maps a 403 to 'unauthenticated', so a guard placed after the fetches never
    runs: the page has already rendered «انتهت الجلسة» to somebody whose session is fine, and
    signing in again lands them here again.
  */
  const refused = await refuseSection('reviews', t.sections.reviewModeration.title);

  if (refused) return refused;

  const { page, size } = await listParamsFor('reviews', searchParams);

  const [result, counts] = await Promise.all([
    getReportedReviews({ page, limit: size }),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={t.sections.reviewModeration.title} counts={counts}>
      <ConsolePanel>
        {result === 'unauthenticated' ? (
          <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
        ) : result === 'failed' ? (
          <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
        ) : (
          <>
            {result.items.length === 0 ? (
              <p className="text-[12.5px] text-faint">
                {t.sections.reviewModeration.empty}
              </p>
            ) : (
              <ul className="grid gap-3">
                {result.items.map((review) => (
                  <li
                    key={review.reference}
                    id={rowAnchor(review.reference)}
                    className="scroll-mt-24 rounded-card border border-line bg-card p-4"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <Ltr className="text-[12px] font-semibold text-sky">
                        {review.reference}
                      </Ltr>
                      <span className="text-sm font-bold text-text">
                        {review.guestName}
                      </span>
                      <span className="text-[11.5px] font-semibold text-gold">
                        {review.propertyName}
                      </span>
                      <span className="text-[11.5px] text-faint">{review.unitName}</span>
                      <span className="text-[12.5px] font-extrabold text-gold">
                        <Ltr>★ {review.rating}</Ltr>
                      </span>
                      <span className="ms-auto text-[11.5px] text-faint">
                        <Ltr>{shortDateTime(review.createdAt)}</Ltr>
                      </span>
                    </div>

                    <p className="mt-2 text-[11px] text-faint">
                      {t.sections.reviewModeration.body}
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-[1.8] text-muted">
                      {review.body}
                    </p>

                    <p className="mt-2.5 text-[11px] text-faint">
                      {t.sections.reviewModeration.reportedBy}
                    </p>
                    <p className="mt-0.5 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-[12.5px] leading-relaxed text-warn">
                      {review.reportReason}
                    </p>

                    <ReviewModeration reference={review.reference} />
                  </li>
                ))}
              </ul>
            )}

            <TablePagination
              basePath="/reviews"
              section="reviews"
              query={{}}
              page={result.page}
              pages={result.pages}
              total={result.total}
              capped={result.capped}
              size={size}
            />
          </>
        )}

        <FootNote>{t.sections.reviewModeration.note}</FootNote>
      </ConsolePanel>
    </ConsoleShell>
  );
}
