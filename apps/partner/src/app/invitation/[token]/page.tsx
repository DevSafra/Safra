import type { Metadata } from 'next';

import { ORNAMENT_BRAND } from '@safra/ui';

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

  /*
    The sign-in shell, exactly (Bashar, 2026-08-21).

    This page was built in a hurry to unblock the joining journey and got its own layout: wider,
    left-aligned, an ornament typed as a literal `۞`, and the form loose on the background with no
    card. It looked like a different product.

    The login page's own note gives the reason this matters, and it applies here with more force:
    a page that does not look like the product it belongs to is indistinguishable from a phishing
    page — and unlike sign-in, THIS page is reached from a link in an email, which is where
    phishing starts. It also asks somebody to choose a password, which is the single most valuable
    thing on it.

    So the shell is the same object: `max-w-sm`, centred, brand ornament, heading, subtitle, form
    in a card. The ornament comes from `@safra/ui` rather than being typed out, so the two screens
    cannot drift by somebody editing one glyph.
  */
  return (
    <main className="mx-auto grid min-h-screen max-w-sm content-center px-4">
      <div className="w-full">
        {/* `aria-hidden`: an ornament is a glyph, and a screen reader announcing it says nothing. */}
        <p className="text-3xl text-gold text-center" aria-hidden>
          {ORNAMENT_BRAND}
        </p>

        <h1 className="mt-3 text-2xl font-semibold text-text text-center">
          {t.invitation.title}
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-muted text-center">
          {t.invitation.intro}
        </p>

        <div className="mt-8 rounded-xl border border-line bg-card p-6">
          <InvitationForm token={token} />
        </div>

        {/*
          Under the card, not inside it. It describes what happens AFTER this form is finished, and
          a note about the next screen sitting among this screen's fields reads as an instruction
          for them.
        */}
        <p className="mt-6 text-xs leading-relaxed text-faint text-center">
          {t.invitation.afterNote}
        </p>
      </div>
    </main>
  );
}
