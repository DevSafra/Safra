import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AccountShell } from '@/components/account-shell';
import { getAccountSummary } from '@/lib/account';
import { ACCOUNT_METADATA, requireAccount } from '@/lib/account-page';

/**
 * الملف الشخصي — handoff §6.
 *
 * Read-only. The name and phone come from `GET /auth/me/profile`, which reads `customer_profiles` —
 * the session cookie carries `id`, `email`, `role` and `permissions` and no name at all, and
 * `GET /auth/me` only echoes the token's claims.
 *
 * Editing still has no endpoint: no profile update, and no password change beyond the emailed RESET
 * flow. The section says so rather than offering a form that could not submit.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = ACCOUNT_METADATA;

export default async function AccountProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: requested } = await params;
  const { locale, session } = await requireAccount(requested, '/profile');

  const summaryRead = await getAccountSummary();
  const summary =
    summaryRead === 'failed' || summaryRead === 'unauthenticated' ? null : summaryRead;

  const t = await getTranslations('account');

  return (
    <AccountShell
      locale={locale}
      active="profile"
      summary={summary}
      title={t('navProfile')}
    >
      <div className="grid gap-6">
        <dl className="grid gap-4 rounded-card border border-line bg-card p-5">
          <div>
            <dt className="text-sm text-muted">{t('profileEmail')}</dt>
            {/* An address is a Latin run on a line that may be Arabic. */}
            <dd className="mt-1 text-text" dir="ltr">
              {session.user.email}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-muted">{t('profileFullName')}</dt>
            <dd className={`mt-1 ${summary ? 'text-text' : 'text-faint'}`}>
              {summary?.fullName || t('profileNotSet')}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-muted">{t('profilePhone')}</dt>
            {/* A phone number is a Latin run, and a leading `+` is what the bidi algorithm moves. */}
            <dd className={`mt-1 ${summary ? 'text-text' : 'text-faint'}`} dir="ltr">
              {summary?.phone || t('profileNotSet')}
            </dd>
          </div>
        </dl>

        <p className="rounded-lg border border-dashed border-gold/35 bg-card p-4 text-sm leading-relaxed text-faint">
          {t('profileEditUnavailable')}
        </p>
      </div>
    </AccountShell>
  );
}
