import Link from 'next/link';

import { getConversations, type ConversationItem } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { count, shortDateTime } from '@/lib/format';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import { FootNote, Ltr, StatusPill } from '@/components/admin-table';
import { TableToolbar } from '@/components/table-toolbar';
import { t } from '@/lib/strings';
import { conversationKind, partyLine } from '@/lib/conversation';
import { StartConversation } from '@/components/start-conversation';
import { returnQuery, rowAnchor } from '@/lib/search-params';
import { listParamsFor } from '@/lib/table-size';
import { refuseSection } from '@/components/section-refusal';

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
  /*
    FIRST, before any fetch.

    `staffFetch` maps a 403 to 'unauthenticated', so a guard placed after the fetches never
    runs: the page has already rendered «انتهت الجلسة» to somebody whose session is fine, and
    signing in again lands them here again.
  */
  const refused = await refuseSection('messages', t.nav.messages);

  if (refused) return refused;

  const { q, page, size } = await listParamsFor('messages', searchParams);

  /*
    «مراسلة» on a customer, a partner or a booking lands here with the recipient already chosen, so
    the composer opens itself. Read as plain strings and handed to the form as DEFAULTS — the API
    resolves the reference inside the reader's own scope, so nothing here is trusted.
  */
  const query = await searchParams;
  const to = typeof query['to'] === 'string' ? query['to'] : undefined;
  const ref = typeof query['ref'] === 'string' ? query['ref'] : undefined;

  // Carried into every thread link, so «رجوع» on the thread screen comes back here.
  const back = returnQuery({ page, size, q });

  const [result, counts] = await Promise.all([
    getConversations({ q, page, limit: size }),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={t.nav.messages} counts={counts}>
      <ConsolePanel>
        <TableToolbar
          action="/messages"
          query={q}
          size={size}
          placeholder={t.sections.messages.searchPlaceholder}
        />

        <StartConversation defaultTo={to} defaultReference={ref} />

        {result === 'unauthenticated' ? (
          <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
        ) : result === 'failed' ? (
          <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
        ) : (
          <>
            {/*
              Addressable like a table row. "Table" means any paged list, not the `<table>`
              element: this is a `<ul>` of cards and it pages, returns and scrolls back like every
              other registry. See `rowAnchor`.
            */}
            {result.items.length === 0 ? (
              <p className="text-[12.5px] text-faint">{t.table.empty}</p>
            ) : (
              <ul className="grid gap-2.5">
                {result.items.map((thread) => (
                  <li
                    key={thread.reference}
                    id={rowAnchor(thread.reference)}
                    className="scroll-mt-24 target:rounded-[11px] target:bg-[rgba(var(--goldA),0.14)]"
                  >
                    <Thread thread={thread} back={back} />
                  </li>
                ))}
              </ul>
            )}
            {/*
              The bar stays when the list is empty, as it does on every other registry — an empty
              result is usually a filter that matched nothing or a page past the end, and hiding
              the pager there strands the reader with no total, no way back to page one and no
              size control. `AdminTable` behaves the same way for the ten `<table>` registries.
            */}
            <TablePagination
              basePath="/messages"
              section="messages"
              query={{ q }}
              page={result.page}
              pages={result.pages}
              total={result.total}
              capped={result.capped}
              size={size}
            />
          </>
        )}

        <FootNote>{t.sections.messages.note}</FootNote>
        <FootNote>{t.sections.messages.redactionNote}</FootNote>
      </ConsolePanel>
    </ConsoleShell>
  );
}

function Thread({ thread, back }: { thread: ConversationItem; back: string }) {
  /*
    The glyph is the first letter of whoever is NOT SAFRA. `partner` first on a host's own thread,
    because that is who the conversation is with — the customer column is empty there.
  */
  const other =
    (thread.subjectKind === 'partner'
      ? (thread.partner ?? thread.customer)
      : (thread.customer ?? thread.partner)) ?? t.sections.messages.unknownParty;

  return (
    <Link
      href={`/messages/${thread.reference}${back}`}
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
          {/*
            `data-parties` so the browser sweep can read the LINE rather than the row.

            Asserting over the row's whole text was vacuous: the avatar glyph is part of it, so a
            «same party on both sides» check compared «ف فندق قصر الشرق» against «فندق قصر الشرق»
            and passed over exactly the defect it was written for.
          */}
          <span
            data-parties={thread.subjectKind}
            className="text-[13px] font-bold text-text"
          >
            {partyLine(thread.subjectKind, thread.customer, thread.partner)}
          </span>
          {/*
            What KIND of thread this is, on every row.

            Four shapes render in this list and they were told apart only by decoding a reference
            prefix — and a ticket had no reference of its own to decode, so two tickets from one
            host were indistinguishable. The word is the thing a reader actually needs before
            deciding whether to open it.
          */}
          <span className="rounded-full border border-line px-2 py-px text-[10px] font-bold text-faint">
            {conversationKind(thread.subjectKind)}
          </span>
          {thread.subjectReference ? (
            <Ltr className="text-[11px] text-sky">{thread.subjectReference}</Ltr>
          ) : null}
        </span>
        <span className="mt-1 block truncate text-xs text-muted">
          {thread.lastMessage ?? t.sections.messages.noMessages}
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
            <StatusPill tone="faint">{t.sections.messages.closed}</StatusPill>
          </span>
        ) : null}
      </span>
    </Link>
  );
}
