import { TwoFactorEnrolment } from '@/components/two-factor-enrolment';
import { getPartnerSession } from '@/lib/session-server';
import { t } from '@/lib/strings';

/**
 * Forced 2FA enrolment for partners (Bashar, 2026-08-07: mandatory, not optional).
 *
 * Middleware routes every unenrolled partner here and lets them reach nothing else — and, unlike
 * the console's equivalent, that is not merely a change in posture. `TwoFactorGuard` refuses every
 * partner API call except enrolment itself, so this screen is the honest face of a refusal the
 * server is already making. A partner who bypasses the portal and calls the API directly gets the
 * same answer.
 *
 * This is also the migration path for partners who existed before the requirement: they sign in
 * with their password as they always did, and land here instead of the dashboard.
 */
export const dynamic = 'force-dynamic';

export default async function EnrolPage() {
  const session = await getPartnerSession();

  return (
    <main className="mx-auto grid min-h-screen max-w-md place-content-center px-4 py-10">
      <div className="w-full">
        <h1 className="font-[family-name:var(--font-amiri)] text-2xl font-bold text-gold">
          {t.twoFactor.title}
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{t.twoFactor.why}</p>
        {/* `dir="ltr"`: an email is a Latin run on an Arabic line. */}
        <p dir="ltr" className="mt-2 text-start text-[12px] text-faint">
          {session?.user.email}
        </p>

        <div className="mt-6 rounded-card border border-line bg-card p-5">
          <TwoFactorEnrolment />
        </div>
      </div>
    </main>
  );
}
