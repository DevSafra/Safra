import { getMyPayoutAccounts, sidebarBadges } from '@/lib/api';
import { requireVerifiedPartner, sectionAccess } from '@/lib/gate';
import { ChangePassword } from '@/components/change-password';
import { PayoutAccountsManager } from '@/components/payout-accounts-manager';
import { SectionRefusal } from '@/components/section-refusal';
import { Shell } from '@/components/shell';
import { t } from '@/lib/strings';

/**
 * الإعدادات — the partner's own account (Bashar, 2026-09-04).
 *
 * *"add a new tab for حسابات التحويل or add it inside a new settings page, where the partner also
 * can change his password"*. Both are here, because they are the two things a partner owns about
 * their ACCOUNT rather than about their listings: where money arrives, and the credential that
 * protects it.
 *
 * ## The PAGE is open; one PANEL is gated
 *
 * This is the whole reason الإعدادات is not simply حسابات التحويل renamed. Payout accounts need
 * `PAYOUT_ACCOUNT_MANAGE_OWN`, which an employee does not hold — but an employee must be able to
 * change their OWN password, and gating the page on the accounts permission would take that away
 * from them. So the page opens for anybody signed in, and the accounts panel explains itself when
 * it is not theirs to see.
 *
 * Getting that backwards is not hypothetical: it is the same mistake as hiding a control and
 * having the endpoint answer differently, which the portal has a standing rule about.
 *
 * ## Why حسابات التحويل moved off its own page
 *
 * It was `/payouts/accounts` — a sub-page of مستحقاتي reached by a link at the bottom of a list.
 * A destination is set up once and revisited rarely, which is exactly the shape of a settings
 * screen and exactly the wrong shape for a tab under the thing a partner reads every month. The
 * old path still resolves; it redirects here, so bookmarks and pasted links keep working.
 */
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [access, profile] = await Promise.all([
    sectionAccess('payoutAccounts'),
    requireVerifiedPartner(),
  ]);

  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  /*
    Only fetched when the reader may have it. `getMyPayoutAccounts` answers 403 for an employee,
    which `partnerFetch` reports as 'unauthenticated' — and a panel saying «انتهت الجلسة» to
    somebody whose session is fine is the refusal explaining the wrong thing.
  */
  const accounts = access === 'open' ? await getMyPayoutAccounts() : null;

  return (
    <Shell
      title={t.settings.title}
      partnerName={name}
      active="settings"
      badges={sidebarBadges(profile)}
    >
      {/* A readable measure: a 1080px password field is a form nobody designed. */}
      <div className="grid max-w-2xl gap-4">
        <section className="grid gap-3 rounded-card border border-line bg-card p-4.5">
          <h2 className="text-[13px] font-bold text-text">
            {t.settings.accountsHeading}
          </h2>

          {access !== 'open' ? (
            <SectionRefusal access={access} />
          ) : accounts === 'unauthenticated' ? (
            <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
          ) : accounts === 'failed' || accounts === null ? (
            <p className="text-sm text-bad">{t.dashboard.loadFailed}</p>
          ) : (
            <>
              <p className="text-[11.5px] leading-relaxed text-faint">
                {t.payoutAccounts.intro}
              </p>
              <PayoutAccountsManager accounts={accounts} />
            </>
          )}
        </section>

        <section className="grid gap-3 rounded-card border border-line bg-card p-4.5">
          <h2 className="text-[13px] font-bold text-text">
            {t.settings.passwordHeading}
          </h2>
          <ChangePassword />
        </section>
      </div>
    </Shell>
  );
}
