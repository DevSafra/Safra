import { getSafraAccounts, getSafraPayouts, getSafraRevenue } from '@/lib/api';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { FootNote } from '@/components/admin-table';
import { SafraAccounts } from '@/components/safra-accounts';
import { SafraPayouts } from '@/components/safra-payouts';
import { SafraRevenueSummary } from '@/components/safra-revenue';
import { refuseSection } from '@/components/section-refusal';
import { sidebarCounts } from '@/lib/console';
import { t } from '@/lib/strings';

/**
 * خزينة سفرة — the platform's own revenue, its destinations, and the transfers between them.
 *
 * ## Why it exists
 *
 * SAFRA's commission, customer fee and advertising revenue accrued as ledger CREDITS and nothing
 * ever debited them: the books knew what the platform had earned and had no concept of what it had
 * collected, and nowhere named the account its money should reach. Partners have had both since
 * 2026-09-04 (Bashar, 2026-09-05).
 *
 * ## Three panels, in the order the work happens
 *
 * The summary first, because «how much is outstanding» is why somebody opens this screen. Then the
 * destinations, because a transfer cannot be paid without a verified active one. Then the
 * transfers themselves. A reader who arrives with no accounts configured meets the thing they must
 * do first, above the thing they cannot do yet.
 *
 * ## Each panel degrades on its own
 *
 * A failure in one read must not take the page down: this is where somebody goes to FIX money, and
 * a screen that refuses to show the revenue because the transfer list blipped is the worse failure.
 */
export const dynamic = 'force-dynamic';

export default async function TreasuryPage() {
  /* FIRST — `staffFetch` maps a 403 to 'unauthenticated', so a later guard never runs. */
  const refused = await refuseSection('treasury', t.nav.treasury);

  if (refused) return refused;

  const [revenue, accounts, payouts, counts] = await Promise.all([
    getSafraRevenue(),
    getSafraAccounts(),
    getSafraPayouts(),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={t.nav.treasury} counts={counts}>
      <ConsolePanel>
        {revenue === 'unauthenticated' ? (
          <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
        ) : revenue === 'failed' ? (
          <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
        ) : (
          <SafraRevenueSummary revenue={revenue} />
        )}

        <FootNote>{t.sections.treasury.note}</FootNote>
      </ConsolePanel>

      <ConsolePanel>
        {accounts === 'unauthenticated' ? (
          <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
        ) : accounts === 'failed' ? (
          <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
        ) : (
          <SafraAccounts accounts={accounts.accounts} />
        )}
      </ConsolePanel>

      <ConsolePanel>
        {payouts === 'unauthenticated' ? (
          <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
        ) : payouts === 'failed' ? (
          <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
        ) : (
          <SafraPayouts payouts={payouts.payouts} />
        )}
      </ConsolePanel>
    </ConsoleShell>
  );
}
