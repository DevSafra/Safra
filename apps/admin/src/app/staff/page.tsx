import Link from 'next/link';

import { getStaff } from '@/lib/api';
import { getStaffSession } from '@/lib/session-server';
import { StaffAdmin } from '@/components/staff-admin';

/**
 * Staff administration (M-5, §9.3).
 *
 * Only `super_admin` holds `staff.manage`, so the API returns 403 to everybody else
 * and this page says so rather than rendering an empty list — an empty list reads as
 * "there are no staff", which is both wrong and alarming.
 */
export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  const [result, session] = await Promise.all([getStaff(), getStaffSession()]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="text-sm text-muted hover:text-gold">
        ← Queues
      </Link>

      <header className="mt-4">
        <h1 className="text-2xl font-semibold text-text">Staff</h1>
        <p className="mt-1 text-sm text-muted">
          Who can sign in to this console, and what they can do. Every change here is
          recorded against your account.
        </p>
      </header>

      <div className="mt-6">
        {result === 'unauthenticated' ? (
          <p className="text-sm text-muted">
            Only a super admin can manage staff accounts.
          </p>
        ) : result === 'failed' ? (
          <p className="text-sm text-bad">Could not load staff accounts.</p>
        ) : (
          <StaffAdmin staff={result.staff} currentUserId={session?.user.id} />
        )}
      </div>
    </main>
  );
}
