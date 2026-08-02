import { AcceptInvitationForm } from '@/components/accept-invitation-form';

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

  return (
    <main className="mx-auto grid min-h-screen max-w-md content-center px-4 py-10">
      <h1 className="text-2xl font-semibold text-text">Set your password</h1>
      <p className="mt-1 text-sm text-muted">
        You have been invited to the SAFRA admin console. Choose a password to activate
        your account.
      </p>

      <div className="mt-6">
        <AcceptInvitationForm token={token} />
      </div>

      <p className="mt-6 text-xs text-faint">
        If you were not expecting this invitation, close this page and tell the SAFRA
        team. Do not set a password.
      </p>
    </main>
  );
}
