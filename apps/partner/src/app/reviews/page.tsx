import { getMyProfile } from '@/lib/api';
import { Shell } from '@/components/shell';
import { t } from '@/lib/strings';

/**
 * التقييمات (design handoff §7.3) — not built, and saying so.
 *
 * There is no reviews table in the schema, no API, and therefore nothing to render. The handoff
 * specifies the screen in full, including P-006 — a partner may reply to a review or report it,
 * never delete one — and that rule needs somewhere to live before this page means anything.
 *
 * Rendered as an honest empty state rather than omitted from the nav: a partner who was told
 * SAFRA collects reviews should find the section and read why it is empty, not wonder whether
 * they have none.
 */
export const dynamic = 'force-dynamic';

export default async function ReviewsPage() {
  const profile = await getMyProfile();
  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  return (
    <Shell title={t.reviews.title} partnerName={name} active="reviews">
      <p className="rounded-[14px] border border-gold/30 bg-gold/5 p-4 text-sm text-gold">
        {t.reviews.notBuilt}
      </p>
      <p className="mt-3 text-[12.5px] text-faint">{t.reviews.rule}</p>
    </Shell>
  );
}
