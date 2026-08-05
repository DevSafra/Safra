import { TwoFactorEnrolment } from '@/components/two-factor-enrolment';
import { getStaffSession } from '@/lib/session-server';
import { t } from '@/lib/strings';

/**
 * Forced 2FA enrolment (SRS §4.1).
 *
 * Middleware routes every unenrolled staff member here and lets them reach nothing
 * else. That is a change in posture rather than a new screen: the API only demands a
 * TOTP code from accounts that have ALREADY enabled it, so a staff account that never
 * enrolled currently signs in on a password alone. Acceptable for an API whose
 * endpoints are individually permissioned; not acceptable for the console that
 * approves partners, reads identity documents and moves wallet balances.
 */
export const dynamic = 'force-dynamic';

export default async function EnrolPage() {
  const session = await getStaffSession();

  return (
    <main className="mx-auto grid min-h-screen max-w-md place-content-center px-4">
      <div className="w-full">
        <h1 className="text-2xl font-semibold text-text">{t.sections.twoFactor.title}</h1>
        <p className="mt-2 text-sm text-muted">{t.sections.twoFactor.requiredNote}</p>
        <p className="mt-1 text-xs text-faint">{session?.user.email}</p>

        <div className="mt-8 rounded-xl border border-line bg-card p-6">
          <TwoFactorEnrolment />
        </div>
      </div>
    </main>
  );
}
