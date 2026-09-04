import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { dialOptions } from '@/lib/dial-options';
import { AccountShell } from '@/components/account-shell';
import { PasswordForm, ProfileForm } from '@/components/profile-forms';
import { getAccountSummary } from '@/lib/account';
import { ACCOUNT_METADATA, requireAccount } from '@/lib/account-page';
import { ltrIsolate } from '@/lib/bidi';

/**
 * الملف الشخصي — handoff §6.
 *
 * The name and phone come from `GET /auth/me/profile`, which reads `customer_profiles`: the session
 * cookie carries `id`, `email`, `role` and `permissions` and no name at all.
 *
 * ## Email is shown but not editable, and the page says why
 *
 * Changing the address somebody signs in with has to prove they still hold the new one — a verification
 * flow with a pending-address column and a mail template, which is a separate feature rather than a
 * field on this form. `profileUpdateSchema` is `.strict()`, so an attempt to send one is refused rather
 * than silently ignored; the sentence under the address is what stops that being a mystery.
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
      title={t('navProfile')}
      summary={summary}
    >
      <div className="grid gap-6">
        <dl className="grid gap-4 rounded-card border border-line bg-card p-5">
          <div>
            <dt className="text-sm text-muted">{t('profileEmail')}</dt>
            {/*
              Isolated, not `dir="ltr"`.

              The address is a Latin run on a line that may be Arabic, so its order has to be left to
              right — but `dir="ltr"` also moves the element's start edge to the left, which put the
              address flush left under a label sitting on the right. The isolate fixes the order and
              leaves the placement to the paragraph.
            */}
            <dd className="mt-1 text-text">{ltrIsolate(session.user.email)}</dd>
            <dd className="mt-1 text-xs leading-relaxed text-faint">
              {t('emailNotEditable')}
            </dd>
          </div>
        </dl>

        {/*
          The form needs the CURRENT values so it can send only what changed, so it renders only once the
          summary has been read. A failed read leaves the fields absent rather than pre-filled with
          blanks that a save would then write over the real name.
        */}
        {summary ? (
          <ProfileForm
            countries={dialOptions(locale)}
            locale={locale}
            initial={{ fullName: summary.fullName, phone: summary.phone }}
            labels={{
              editTitle: t('profileEditTitle'),
              fullName: t('profileFullName'),
              phone: t('profilePhone'),
              phoneHint: t('profilePhoneHint'),
              save: t('profileSave'),
              saving: t('profileSaving'),
              saved: t('profileSaved'),
              saveFailed: t('profileSaveFailed'),
            }}
          />
        ) : (
          <p className="text-sm text-bad">{t('loadFailed')}</p>
        )}

        <PasswordForm
          locale={locale}
          labels={{
            title: t('passwordTitle'),
            current: t('passwordCurrent'),
            next: t('passwordNew'),
            confirm: t('passwordConfirm'),
            mismatch: t('passwordMismatch'),
            show: t('passwordShow'),
            hide: t('passwordHide'),
            submit: t('passwordSubmit'),
            submitting: t('passwordSubmitting'),
            changed: t('passwordChanged'),
            wrong: t('passwordWrong'),
            failed: t('passwordFailed'),
            rule: t('passwordRule'),
          }}
        />
      </div>
    </AccountShell>
  );
}
