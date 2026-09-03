import { ORNAMENT_BRAND } from '@safra/ui';

import { AcceptInvitationForm } from '@/components/accept-invitation-form';
import { t } from '@/lib/strings';

/**
 * Accepting a staff invitation (M-5).
 *
 * Reachable without a session — see the note on `PUBLIC_PATHS` in `middleware.ts`. An
 * invited staff member cannot sign in yet, because their account has no password
 * until this page gives it one.
 *
 * The token is not validated here. Doing so would need a second endpoint that reports
 * whether a token is good, which is an oracle for guessing them; the single POST that
 * redeems it is the only check, and it fails generically.
 */
export const dynamic = 'force-dynamic';

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  /*
    The sign-in shell, exactly — see the partner portal's invitation page for the reasoning.

    Closer to `/login` than the partner one was, but still its own thing: no brand ornament, wider,
    left-aligned, and the form on the background rather than in a card. This is the screen a new
    member of staff meets FIRST, from a link in an email, and it asks them to choose the password
    that protects the console. It should be unmistakably the console.
  */
  return (
    <main className="mx-auto grid min-h-screen max-w-sm content-center px-4">
      <div className="w-full">
        {/* `aria-hidden`: an ornament is a glyph, and a screen reader announcing it says nothing. */}
        <p className="text-3xl text-gold text-center" aria-hidden>
          {ORNAMENT_BRAND}
        </p>

        <h1 className="mt-3 text-2xl font-semibold text-text text-center">
          {t.sections.invitation.setPassword}
        </h1>
        <p className="mt-1 text-sm text-muted text-center">
          {t.sections.invitation.invitedNote}
        </p>

        <div className="mt-8 rounded-card border border-line bg-card p-6">
          <AcceptInvitationForm token={token} />
        </div>

        <p className="mt-6 text-xs leading-relaxed text-faint text-center">
          {t.sections.invitation.unexpectedNote}
        </p>
      </div>
    </main>
  );
}
