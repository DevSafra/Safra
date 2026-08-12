import Link from 'next/link';

import { getMyProfile, getMySupportTickets, sidebarBadges } from '@/lib/api';
import { Shell } from '@/components/shell';
import { Ltr } from '@/components/ltr';
import { SupportForm } from '@/components/support-form';
import { fill, t } from '@/lib/strings';

/**
 * الدعم — a partner asking SAFRA for help (Bashar, 2026-08-12).
 *
 * The same endpoint the customer app calls; the API scopes by `partnerId` from the verified token, so a
 * partner sees their own threads and nothing else. A ticket is a CONVERSATION with no other subject, which
 * puts it in the console's existing inbox rather than in a second queue staff have to remember.
 *
 * The open form sits above the list, because somebody arriving here has a problem and should not have to
 * scroll past their own history to report it.
 */
export const dynamic = 'force-dynamic';

export default async function SupportPage() {
  const [profile, tickets] = await Promise.all([getMyProfile(), getMySupportTickets()]);

  const partnerName =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  return (
    <Shell
      title={t.support.title}
      partnerName={partnerName}
      active="support"
      badges={sidebarBadges(profile)}
    >
      <p className="text-[12.5px] text-muted">{t.support.intro}</p>

      <section className="mt-4 rounded-[14px] border border-line bg-card p-4">
        <h2 className="font-[family-name:var(--font-amiri)] text-[18px] text-text">
          {t.support.openTitle}
        </h2>
        <div className="mt-3">
          <SupportForm />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-[family-name:var(--font-amiri)] text-[18px] text-text">
          {t.support.mineTitle}
        </h2>

        {tickets === 'failed' || tickets === 'unauthenticated' ? (
          <p className="mt-3 text-[12.5px] text-bad">{t.dashboard.loadFailed}</p>
        ) : tickets.items.length === 0 ? (
          <p className="mt-3 rounded-[14px] border border-line bg-card p-5 text-center text-[12.5px] text-muted">
            {t.support.none}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {tickets.items.map((ticket) => (
              <li key={ticket.reference}>
                <Link
                  href={`/support/${encodeURIComponent(ticket.reference)}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line bg-card p-4 transition-colors hover:border-[rgba(var(--goldA),0.4)]"
                >
                  <span className="min-w-0">
                    <Ltr className="block text-[12.5px] text-text">
                      {ticket.reference}
                    </Ltr>
                    {ticket.lastMessage ? (
                      <span className="mt-1 block truncate text-[12.5px] text-muted">
                        {ticket.lastMessage}
                      </span>
                    ) : null}
                    <span className="mt-1 block text-[11px] text-faint">
                      {fill(t.support.messages, { count: String(ticket.messageCount) })}
                    </span>
                  </span>

                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${
                      ticket.closed
                        ? 'border-line bg-field text-faint'
                        : 'border-ok/40 bg-ok/10 text-ok'
                    }`}
                  >
                    {ticket.closed ? t.support.closedLabel : t.support.openLabel}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}
