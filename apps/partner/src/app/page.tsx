import { getMyProfile, getMyProperties } from '@/lib/api';
import { Shell } from '@/components/shell';
import { fill, t } from '@/lib/strings';

/**
 * لوحة التحكم (design handoff §7.1).
 *
 * ## What is here, and what is honestly absent
 *
 * The handoff draws KPI cards, a booking calendar, recent activity and a payout line —
 * *"تحويل مستحقات 1,240$ مجدول يوم الخميس"*. Two of those have nothing behind them yet: there is
 * no payouts table, and the console's own الدفع screen already admits that partner transfers are
 * absent rather than deriving a figure from `partner_payable_amount` and presenting an obligation
 * as a transfer that happened.
 *
 * So this shows what the platform actually knows — the listings and their states — and the rest
 * arrives when the data does. A confident number for a feature that does not exist is the one
 * failure mode a dashboard about somebody's money must not have.
 */
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const [profile, properties] = await Promise.all([getMyProfile(), getMyProperties()]);
  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  return (
    <Shell title={t.dashboard.title} partnerName={name} active="dashboard">
      {properties === 'unauthenticated' ? (
        <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
      ) : properties === 'failed' ? (
        <p className="text-sm text-bad">{t.dashboard.loadFailed}</p>
      ) : (
        <section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <Kpi
            label={t.nav.properties}
            value={fill(t.properties.count, { n: properties.length })}
          />
        </section>
      )}
    </Shell>
  );
}

function Kpi({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-card p-4">
      <p className="text-[11.5px] text-faint">{label}</p>
      <p className="mt-1 text-2xl font-bold text-text">{value}</p>
    </div>
  );
}
