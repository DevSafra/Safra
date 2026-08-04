import Link from 'next/link';

import { getConversations, type ConversationItem } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { count, shortDateTime } from '@/lib/format';
import { ConsolePanel, ConsoleShell, Pager } from '@/components/console-shell';
import { FootNote, Ltr, StatusPill } from '@/components/admin-table';
import { TableToolbar } from '@/components/table-toolbar';
import { AR } from '@/lib/strings';
import { listParams } from '@/lib/search-params';

/**
 * الرسائل — the three-party inbox (design handoff §8).
 *
 * Rows, not a table: the design draws each conversation as a card with an Amiri glyph avatar, the
 * party line, the linked reference, the last message and an unread badge. A grid would lose the one
 * thing that matters at a glance — which thread is waiting on SAFRA.
 *
 * The glyph is the first letter of whoever is NOT SAFRA, in Amiri, exactly as the prototype does.
 * It is decorative, so it carries `aria-hidden` and the accessible name comes from the party line.
 */
export const dynamic = 'force-dynamic';

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q, cursor } = await listParams(searchParams);

  const [result, counts] = await Promise.all([
    getConversations({ q, cursor }),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={AR.nav.messages} counts={counts}>
      <ConsolePanel>
        <TableToolbar
          action="/messages"
          query={q}
          placeholder={AR.sections.messages.searchPlaceholder}
        />

        {result === 'unauthenticated' ? (
          <p className="text-[12.5px] text-muted">{AR.dashboard.sessionExpired}</p>
        ) : result === 'failed' ? (
          <p className="text-[12.5px] text-bad">{AR.dashboard.queueFailed}</p>
        ) : result.items.length === 0 ? (
          <p className="text-[12.5px] text-faint">{AR.table.empty}</p>
        ) : (
          <>
            <ul className="grid gap-2.5">
              {result.items.map((thread) => (
                <li key={thread.reference}>
                  <Thread thread={thread} />
                </li>
              ))}
            </ul>
            <Pager basePath="/messages" query={{ q }} nextCursor={result.nextCursor} />
          </>
        )}

        <FootNote>{AR.sections.messages.note}</FootNote>
        <FootNote>{AR.sections.messages.redactionNote}</FootNote>
      </ConsolePanel>
    </ConsoleShell>
  );
}

function Thread({ thread }: { thread: ConversationItem }) {
  const other = thread.customer ?? thread.partner ?? '—';

  return (
    <Link
      href={`/messages/${thread.reference}`}
      className="flex flex-wrap items-center gap-3 rounded-[11px] border border-line bg-field px-4 py-3 transition-colors hover:border-[rgba(var(--goldA),0.4)]"
    >
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-full border border-[rgba(var(--goldA),0.3)] bg-[rgba(var(--goldA),0.12)] font-[family-name:var(--font-amiri)] font-bold text-gold"
      >
        {other.slice(0, 1)}
      </span>

      <span className="min-w-[200px] flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-bold text-text">
            {AR.sections.messages.parties(other, thread.partner ?? '—')}
          </span>
          {thread.subjectReference ? (
            <Ltr className="text-[11px] text-sky">{thread.subjectReference}</Ltr>
          ) : null}
        </span>
        <span className="mt-1 block truncate text-xs text-muted">
          {thread.lastMessage ?? AR.sections.messages.noMessages}
        </span>
      </span>

      <span className="text-end">
        <span className="block text-[11px] text-faint">
          {shortDateTime(thread.lastMessageAt)}
        </span>
        {/* The design's red unread pill. Staff-side count — see the schema comment. */}
        {thread.unreadForStaff > 0 ? (
          <span className="mt-1.5 inline-block rounded-full bg-bad px-2 py-px text-[10px] font-extrabold text-white">
            {count(thread.unreadForStaff)}
          </span>
        ) : null}
        {thread.closed ? (
          <span className="mt-1.5 block">
            <StatusPill tone="faint">{AR.sections.messages.closed}</StatusPill>
          </span>
        ) : null}
      </span>
    </Link>
  );
}
