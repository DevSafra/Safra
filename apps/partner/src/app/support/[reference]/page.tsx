import Link from 'next/link';
import { notFound } from 'next/navigation';

import { renderRedactions } from '@safra/i18n';

import { getMyProfile, getSupportThread, sidebarBadges } from '@/lib/api';
import { Shell } from '@/components/shell';
import { Ltr } from '@/components/ltr';
import { SupportForm } from '@/components/support-form';
import { SupportClose } from '@/components/support-close';
import { fill, t } from '@/lib/strings';

/**
 * One support thread, partner side.
 *
 * ## A thread that is not this partner's is a 404
 *
 * The API answers 404 for another partner's ticket indistinguishably from one that does not exist, and
 * this page renders `notFound()` for both. `CNV-` references are sequential, so any difference between the
 * two answers would let one partner count another's requests.
 *
 * ## Internal staff notes are not here
 *
 * Staff use the same thread to write to each other. The API filters those out in one place, and this page
 * has no way to ask for them — there is no flag to get wrong.
 */
export const dynamic = 'force-dynamic';

const SENDER = {
  partner: () => t.support.senderPartner,
  staff: () => t.support.senderStaff,
  system: () => t.support.senderSystem,
  /* A customer never writes into a partner's support thread, but the enum allows it — so name it. */
  customer: () => t.support.senderStaff,
} as const;

export default async function SupportThreadPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const [profile, thread] = await Promise.all([
    getMyProfile(),
    getSupportThread(reference),
  ]);

  if (thread === 'failed') notFound();

  const partnerName =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  if (thread === 'unauthenticated') {
    return (
      <Shell
        title={t.support.title}
        partnerName={partnerName}
        active="support"
        badges={sidebarBadges(profile)}
      >
        <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
      </Shell>
    );
  }

  return (
    <Shell
      title={t.support.title}
      partnerName={partnerName}
      active="support"
      badges={sidebarBadges(profile)}
    >
      <Link
        href="/support"
        className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg border border-line px-4 text-[12.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.4)] hover:text-gold lg:min-h-0 lg:py-2"
      >
        {/* The arrow is its own flex item so `dir="rtl"` places it rather than the bidi algorithm. */}
        <span aria-hidden="true">→</span>
        {t.support.back}
      </Link>

      <section className="mt-4 rounded-[14px] border border-line bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Ltr className="text-[12.5px] text-text">{thread.reference}</Ltr>
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              thread.closed
                ? 'border-line bg-field text-faint'
                : 'border-ok/40 bg-ok/10 text-ok'
            }`}
          >
            {thread.closed ? t.support.closedLabel : t.support.openLabel}
          </span>
        </div>

        <ol className="mt-4 space-y-2">
          {thread.messages.map((message) => (
            <li
              key={message.id}
              /* Staff messages are tinted differently; the sender's name above each one carries the
                 meaning, so colour is reinforcement rather than the signal. */
              className={`rounded-lg border p-3 ${
                message.sender === 'staff'
                  ? 'border-sky/30 bg-sky/5'
                  : 'border-line bg-field'
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[11px] font-semibold text-muted">
                  {SENDER[message.sender]()}
                </span>
                <Ltr className="text-[11px] text-faint">
                  {message.createdAt.slice(0, 16).replace('T', ' ')}
                </Ltr>
              </div>

              <p className="mt-2 text-[12.5px] leading-relaxed whitespace-pre-wrap text-text">
                {/*
                  `'ar'` explicitly: لوحة الشريك is Arabic-only, and the stored body carries a
                  language-neutral token where a contact detail was removed — see `O-i18n-2`.
                */}
                {renderRedactions(message.body, 'ar')}
              </p>

              {/* Said out loud: a masked number is silent in the body, and the sender would otherwise
                  wait for a call that cannot come. */}
              {message.redactedCount > 0 ? (
                <p className="mt-2 text-[11px] text-warn">
                  {fill(t.support.redacted, { count: String(message.redactedCount) })}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {thread.closed ? (
        <p className="mt-4 rounded-[14px] border border-line bg-card p-4 text-[12.5px] text-muted">
          {t.support.closedNote}
        </p>
      ) : (
        <section className="mt-4 rounded-[14px] border border-line bg-card p-4">
          <SupportForm reference={thread.reference} />

          {/* Ending the thread sits under the reply, not beside it: the common action leads. */}
          <div className="mt-4 border-t border-line pt-4">
            <SupportClose reference={thread.reference} />
          </div>
        </section>
      )}
    </Shell>
  );
}
