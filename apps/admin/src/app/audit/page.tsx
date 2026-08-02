import Link from 'next/link';

import { getAuditActions, getAuditLog } from '@/lib/api';

/**
 * The audit trail (SRS §15, §9.3, roadmap item 65).
 *
 * Written since the first endpoint shipped and readable only with SQL access until
 * now — which meant the record designed to answer "who did this" was reachable only
 * by the people least likely to be its subject.
 *
 * Filtered rather than searched, and every filter maps onto an existing index. The
 * obvious next request is free-text over the before/after payloads; that is
 * deliberately absent, because an unindexed jsonb scan over a table that only grows
 * would become the slowest query in the system.
 */
export const dynamic = 'force-dynamic';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;

  const action = first(query['action']);
  const actorEmail = first(query['actorEmail']);
  const cursor = first(query['cursor']);

  const [page, actionList] = await Promise.all([
    getAuditLog({ action, actorEmail, cursor, limit: '50' }),
    getAuditActions(),
  ]);

  if (page === 'unauthenticated') {
    return (
      <Shell>
        <p className="text-sm text-muted">
          Your session expired, or this account cannot read the audit log.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <header>
        <h1 className="text-2xl font-semibold text-text">Audit log</h1>
        <p className="mt-1 text-sm text-muted">
          Every recorded action, newest first. Append-only — nothing here can be edited or
          removed, including by this console.
        </p>
      </header>

      {/*
        A GET form, so a filtered view is a shareable URL. An investigation is
        collaborative: "look at this" should be a link, not a description of which
        dropdowns to set.
      */}
      <form method="get" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <label className="grid gap-1">
          <span className="text-xs text-muted">Action</span>
          <select
            name="action"
            defaultValue={action ?? ''}
            className="rounded-lg border border-line bg-field px-3 py-2 text-sm text-text"
          >
            <option value="">All actions</option>
            {actionList !== 'failed' && actionList !== 'unauthenticated'
              ? actionList.actions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))
              : null}
          </select>
        </label>

        <label className="grid gap-1">
          <span className="text-xs text-muted">Actor email</span>
          <input
            name="actorEmail"
            type="email"
            defaultValue={actorEmail ?? ''}
            placeholder="anyone"
            className="rounded-lg border border-line bg-field px-3 py-2 text-sm text-text"
          />
        </label>

        <button
          type="submit"
          className="self-end rounded-lg border border-line px-4 py-2 text-sm text-muted hover:border-gold/50 hover:text-gold"
        >
          Filter
        </button>
      </form>

      {page === 'failed' ? (
        <p className="text-sm text-bad">Could not load the audit log.</p>
      ) : page.items.length === 0 ? (
        <p className="rounded-lg border border-line bg-card p-4 text-sm text-faint">
          Nothing matches those filters.
        </p>
      ) : (
        <>
          <ul className="grid gap-2">
            {page.items.map((entry) => (
              <li
                key={entry.id}
                className="rounded-lg border border-line bg-card px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm text-text">
                    {entry.action.replace(/[._]/g, ' ')}
                  </span>
                  <span className="text-xs text-faint">
                    {entry.createdAt.slice(0, 19).replace('T', ' ')} UTC
                  </span>
                </div>

                <p className="mt-0.5 text-xs text-muted">
                  {entry.actorEmail ?? 'system'}
                  {entry.actorRole
                    ? ` (${entry.actorRole.replace(/_/g, ' ')})`
                    : ''} · {entry.subjectType}
                  {entry.ipAddress ? ` · ${entry.ipAddress}` : ''}
                </p>

                {entry.reason ? (
                  <p className="mt-1 text-xs text-muted">“{entry.reason}”</p>
                ) : null}

                {/*
                  Before and after verbatim. A summary would lose the one detail the
                  question usually turns on — which value, exactly, changed to what.
                */}
                {entry.before || entry.after ? (
                  <pre className="mt-2 overflow-x-auto rounded border border-line bg-field p-2 text-xs text-faint">
                    {JSON.stringify({ before: entry.before, after: entry.after })}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>

          {page.nextCursor ? (
            <Link
              href={`/audit?${new URLSearchParams({
                ...(action ? { action } : {}),
                ...(actorEmail ? { actorEmail } : {}),
                cursor: page.nextCursor,
              }).toString()}`}
              className="justify-self-start rounded-lg border border-line px-4 py-2 text-sm text-muted hover:border-gold/50 hover:text-gold"
            >
              Older entries →
            </Link>
          ) : null}
        </>
      )}
    </Shell>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link href="/" className="text-sm text-muted hover:text-gold">
        ← Queues
      </Link>
      <div className="mt-4 grid gap-6">{children}</div>
    </main>
  );
}
