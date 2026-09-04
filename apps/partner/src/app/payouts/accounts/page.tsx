import Link from 'next/link';

import { getMyPayoutAccounts, sidebarBadges } from '@/lib/api';
import { requireVerifiedPartner, sectionAccess } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { SectionRefusal } from '@/components/section-refusal';
import { PayoutAccountsManager } from '@/components/payout-accounts-manager';
import { t } from '@/lib/strings';

/**
 * حسابات التحويل — where this partner's money arrives (Bashar, 2026-09-04).
 *
 * ## Why it is its own page rather than a panel on مستحقاتي
 *
 * Two reasons, and the second is a rule. It is a different TASK: a destination is set up once and
 * revisited rarely, while «what have I been paid» is read every month, and stacking a form above a
 * table makes the common thing the thing you scroll past. And «مرفوض» on an account beside «ملغى»
 * on a payout would be two red pills on one screen for two unrelated facts, which is exactly the
 * collision «One status, one word, one colour» forbids.
 *
 * ## The owner's, not an employee's
 *
 * `payoutAccounts` gates on `PAYOUT_ACCOUNT_MANAGE_OWN`, which is absent from
 * `PARTNER_EMPLOYEE_PERMISSIONS`. A receptionist who reaches this by a typed URL or a pasted link
 * is told it belongs to the owner, BEFORE the fetch that would refuse them — a hidden control and
 * a refused request must not disagree, and the refusal has to be able to explain itself.
 */
export const dynamic = 'force-dynamic';

export default async function PayoutAccountsPage() {
  const [access, profile] = await Promise.all([
    sectionAccess('payoutAccounts'),
    requireVerifiedPartner(),
  ]);
  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  if (access !== 'open') {
    return (
      <Shell
        title={t.payoutAccounts.title}
        partnerName={name}
        active="payouts"
        badges={sidebarBadges(profile)}
      >
        <SectionRefusal access={access} />
      </Shell>
    );
  }

  const accounts = await getMyPayoutAccounts();

  return (
    <Shell
      title={t.payoutAccounts.title}
      partnerName={name}
      active="payouts"
      badges={sidebarBadges(profile)}
    >
      {accounts === 'unauthenticated' ? (
        <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
      ) : accounts === 'failed' ? (
        <p className="text-sm text-bad">{t.dashboard.loadFailed}</p>
      ) : (
        <div className="grid gap-3.5">
          <p className="text-[12px] leading-relaxed text-faint">
            {t.payoutAccounts.intro}
          </p>

          <PayoutAccountsManager accounts={accounts} />

          <Link
            href="/payouts"
            className="inline-flex min-h-10 w-fit items-center text-[12.5px] font-semibold text-gold hover:underline lg:min-h-0"
          >
            {t.payouts.title}
          </Link>
        </div>
      )}
    </Shell>
  );
}
