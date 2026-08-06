import { getThread, type ThreadMessage } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { count, shortDateTime } from '@/lib/format';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { FootNote, Ltr } from '@/components/admin-table';
import { ReplyForm } from '@/components/reply-form';
import { BackLink } from '@/components/back-link';
import { returnHref } from '@/lib/search-params';
import { fill, t } from '@/lib/strings';

/**
 * One three-party thread, in the order it was written (design handoff §8).
 *
 * ## Sender is shown by ROLE, not by name
 *
 * "العميل" / "الشريك" / "سفرة" rather than an email, because that is what decides how to read the
 * message. The staff email is shown alongside, since internal accountability is the other thing
 * this screen is for.
 *
 * ## The mask is counted and stated
 *
 * A message with removed contact details says how many spans went. Silently showing the cleaned
 * text would hide that somebody tried, which is the signal a partner-score review needs.
 */
export const dynamic = 'force-dynamic';

export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  /* The list position to return to — see the note in the bookings detail screen. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reference } = await params;
  const back = returnHref('/messages', await searchParams, reference);

  const [result, counts] = await Promise.all([getThread(reference), sidebarCounts()]);

  return (
    <ConsoleShell title={t.nav.messages} subtitle={reference} counts={counts}>
      <div className="grid gap-4">
        <ConsolePanel>
          <BackLink href={back} section={t.nav.messages} />

          {result === 'unauthenticated' ? (
            <p className="mt-3 text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
          ) : result === 'failed' ? (
            <p className="mt-3 text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
          ) : result.messages.length === 0 ? (
            <p className="mt-3 text-[12.5px] text-faint">
              {t.sections.messages.noMessages}
            </p>
          ) : (
            <ul className="mt-3 grid gap-2.5">
              {result.messages.map((message) => (
                <li key={`${message.at}-${message.body.slice(0, 12)}`}>
                  <Message message={message} />
                </li>
              ))}
            </ul>
          )}

          <FootNote>{t.sections.messages.note}</FootNote>
        </ConsolePanel>

        {result === 'unauthenticated' || result === 'failed' ? null : (
          <ConsolePanel>
            <ReplyForm reference={reference} />
          </ConsolePanel>
        )}
      </div>
    </ConsoleShell>
  );
}

function Message({ message }: { message: ThreadMessage }) {
  return (
    <div
      /*
        An internal note is visually distinct — dashed border — because the one mistake worth
        preventing on this screen is reading a staff note as something the customer was told.
      */
      className={`rounded-[10px] border px-3.5 py-2.5 ${
        message.internal
          ? 'border-dashed border-[rgba(var(--warnA),0.45)] bg-[rgba(var(--warnA),0.06)]'
          : 'border-line bg-field'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] font-bold text-gold">
          {senderLabel(message.senderKind)}
        </span>
        {message.senderEmail ? (
          <Ltr className="text-[10.5px] text-faint">{message.senderEmail}</Ltr>
        ) : null}
        {message.internal ? (
          <span className="rounded bg-[rgba(var(--warnA),0.15)] px-2 py-px text-[10px] font-bold text-warn">
            {t.sections.messages.internalNote}
          </span>
        ) : null}
        <Ltr className="ms-auto text-[10.5px] text-faint">
          {shortDateTime(message.at)}
        </Ltr>
      </div>

      <p className="mt-1.5 text-[12.5px] leading-relaxed text-text2">{message.body}</p>

      {message.redactedCount > 0 ? (
        <p className="mt-1 text-[10.5px] text-warn">
          {fill(t.sections.messages.redacted, { n: count(message.redactedCount) })}
        </p>
      ) : null}
    </div>
  );
}

function senderLabel(kind: string): string {
  switch (kind) {
    case 'customer':
      return t.sections.messages.senderCustomer;
    case 'partner':
      return t.sections.messages.senderPartner;
    case 'staff':
      return t.sections.messages.senderStaff;
    default:
      return t.sections.messages.senderSystem;
  }
}
