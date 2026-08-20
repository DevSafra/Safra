import type { Metadata } from 'next';

import { InvitationForm } from '@/components/invitation-form';
import { t } from '@/lib/strings';

/**
 * «أنشئ حساب الشريك» — where an accepted partner sets their first password.
 *
 * ## Why this page exists
 *
 * It did not, until 2026-08-20, and its absence broke the entire partner joining process.
 *
 * Accepting a partnership request creates the partner record, leaves the applicant's account as a
 * CUSTOMER account, and emails a link to `/invitation/{token}`. Redeeming that token is the only
 * thing that promotes the account — `acceptInvitation` sets the password and the role in one
 * statement. The endpoint had been built and worked; the page the mail pointed at had not, so the
 * portal answered the link with a redirect to a sign-in that refuses a customer account with «هذا
 * الحساب ليس حساب شريك».
 *
 * The result was a dead end nobody could get past: every accepted partner was stranded, and every
 * partner on the platform had come from the seed instead. Reported by Bashar, who accepted a
 * partner and found there was nothing he could do next.
 *
 * ## The token is not read here
 *
 * It is passed to the form and sent with the submission. This page never validates it and never
 * says whether it is real: a page that rendered "this link is invalid" before anything was
 * submitted would confirm which tokens exist to anybody trying them, and a token IS a credential —
 * whoever holds a live one can set the password on that account.
 *
 * ## No session is issued on success
 *
 * The API deliberately answers with nothing, and the form sends the partner to sign in normally.
 * That keeps ONE code path minting partner sessions — the one that also emails a sign-in code.
 */
export const metadata: Metadata = { title: t.invitation.title };

/** Never cached: it is a form against a single-use credential. */
export const dynamic = 'force-dynamic';

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-md content-center gap-6 px-6 py-12">
      <header className="grid gap-2">
        <p className="text-sm text-gold">۞ {t.login.title}</p>
        <h1 className="text-2xl font-extrabold text-text">{t.invitation.title}</h1>
        <p className="text-sm leading-relaxed text-muted">{t.invitation.intro}</p>
      </header>

      <InvitationForm token={token} />

      <p className="text-xs leading-relaxed text-faint">{t.invitation.afterNote}</p>
    </main>
  );
}
