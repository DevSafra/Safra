import type { Metadata } from 'next';

import { ORNAMENT_BRAND } from '@safra/ui';

import { EmployeeInvitationForm } from '@/components/employee-invitation-form';
import { t } from '@/lib/strings';

/**
 * «تفعيل حساب الموظّف» — where an invited employee sets their first password.
 *
 * The employee half of the joining journey, and the same lesson the partner invitation page was
 * built from: an endpoint that works and a page that does not exist is a dead end nobody can get
 * past. `POST /partner/employee-invitation` is the ONLY thing that promotes the account to
 * `partner_employee`; without this screen the mail's link would land on a sign-in that refuses a
 * customer account, and every invited employee would be stranded exactly as every accepted partner
 * was on 2026-08-20.
 *
 * ## The token is not read here
 *
 * It is handed to the form and travels with the submission. This page never validates it, never
 * resolves it to a business, and never says whether it is real — a screen that answered "this link
 * is invalid" before anything was submitted would confirm which tokens exist to anybody trying
 * them, and a token IS a credential: whoever holds a live one sets the password on that account.
 *
 * That is also why the intro does not name the employer, though it would be friendlier if it did.
 * Naming the business means resolving the token first, which turns this page into an oracle for
 * both "is this token live" and "which business does it belong to". The invitation EMAIL names the
 * employer, and it reaches only the address the partner typed.
 *
 * ## The sign-in shell, exactly
 *
 * Same object as `/login` and `/invitation/[token]`: `max-w-sm`, centred, brand ornament from
 * `@safra/ui` rather than a typed glyph, heading, subtitle, form in a card. The reason is recorded
 * on the partner invitation page and applies here with the same force — a page that does not look
 * like the product it belongs to is indistinguishable from a phishing page, and this one is
 * reached from a link in an email and asks somebody to choose a password.
 *
 * ## No session on success
 *
 * The API answers with nothing and the form sends them to sign in normally, so there is one code
 * path minting partner-side sessions. It is also what makes activation safe to repeat harmlessly:
 * a spent token cannot be turned into a live session by replaying it.
 */
export const metadata: Metadata = { title: t.employeeInvitation.title };

/** Never cached: a form against a single-use credential. */
export const dynamic = 'force-dynamic';

export default async function EmployeeInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <main className="mx-auto grid min-h-screen max-w-sm content-center px-4">
      <div className="w-full">
        {/* `aria-hidden`: an ornament is a glyph, and a screen reader announcing it says nothing. */}
        <p className="text-3xl text-gold-ink text-center" aria-hidden>
          {ORNAMENT_BRAND}
        </p>

        <h1 className="mt-3 text-2xl font-semibold text-text text-center">
          {t.employeeInvitation.title}
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-muted text-center">
          {t.employeeInvitation.intro}
        </p>

        <div className="mt-8 rounded-card border border-line bg-card p-6">
          <EmployeeInvitationForm token={token} />
        </div>

        {/*
          Under the card, not inside it — it describes what happens AFTER the form, and a note
          about the next screen sitting among this screen's fields reads as an instruction for them.

          It says the employer decides what they can see, because an employee who signs in to four
          sections where a colleague has seven will otherwise conclude the portal is broken.
        */}
        <p className="mt-6 text-xs leading-relaxed text-faint text-center">
          {t.employeeInvitation.afterNote}
        </p>
      </div>
    </main>
  );
}
