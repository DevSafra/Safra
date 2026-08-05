import { AdminSidebar, type SidebarCounts } from '@/components/admin-sidebar';
import { SignOutButton } from '@/components/sign-out-button';
import { ThemeToggle } from '@/components/theme-toggle';
import { t } from '@/lib/strings';

/**
 * The console frame: sidebar, title row, content.
 *
 * A component rather than a route-group `layout.tsx` because the sidebar's badges are
 * per-page data. A layout cannot receive them from the page below it, so it would have to
 * fetch the counters itself on every navigation — a second round trip for numbers the page
 * has usually already loaded.
 *
 * The dashboard does not use this: its header carries the date, the role and the emergency
 * control, which no other section has.
 */
export function ConsoleShell({
  title,
  subtitle,
  counts,
  children,
}: {
  title: string;
  subtitle?: string;
  counts: SidebarCounts;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto grid max-w-[1380px] gap-5 px-6 pt-6 pb-16 lg:grid-cols-[220px_1fr] lg:items-start">
      <AdminSidebar counts={counts} />

      <main className="min-w-0">
        <header className="mb-4 flex flex-wrap items-center gap-3">
          <div>
            <h1 className="font-[family-name:var(--font-amiri)] text-[28px] leading-tight text-text">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-0.5 text-[11.5px] text-faint">{subtitle}</p>
            ) : null}
          </div>

          <div className="ms-auto flex items-center gap-2">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}

/** A section card, matching the dashboard's panels so the console reads as one surface. */
export function ConsolePanel({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[15px] border border-[rgba(var(--goldA),0.14)] bg-card p-4.5">
      {title ? (
        <h2 className="mb-3 text-[14.5px] font-extrabold text-gold">{title}</h2>
      ) : null}
      {children}
    </section>
  );
}

/**
 * A KPI card (§9.4: 24px/800 figure, 11.5px label, 10.5px sub; §9.5: 13px radius).
 *
 * `value` is a string, not a number, so the caller formats it — an amount, a percentage and a
 * count need different formatting and a component that guessed would get one of them wrong.
 */
export function Kpi({
  label,
  value,
  sub,
  valueClass = 'text-text',
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-[13px] border border-[rgba(var(--goldA),0.14)] bg-card p-4">
      <p className="text-[11.5px] text-faint">{label}</p>
      <p className={`mt-1.5 text-2xl font-extrabold ${valueClass}`}>{value}</p>
      {sub ? <p className="mt-1 text-[10.5px] text-muted">{sub}</p> : null}
    </div>
  );
}

/** The KPI row, on the design's `auto-fit / minmax(160px, 1fr)` grid. */
export function KpiRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3"
    >
      {children}
    </section>
  );
}

/**
 * "Next page" for a cursor-paginated table.
 *
 * A forward-only link, not numbered pages: a cursor cannot address page 7 without walking to
 * it, and rendering `1 2 3 … 140` over keyset pagination would be a lie about what the API can
 * do. The cursor lives in the URL, so back/forward and reload behave correctly for free.
 */
export function Pager({
  basePath,
  query,
  nextCursor,
}: {
  basePath: string;
  /** Current filters, carried forward so paging does not silently drop the search. */
  query: Record<string, string | undefined>;
  nextCursor: string | null;
}) {
  if (!nextCursor) return null;

  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }

  params.set('cursor', nextCursor);

  return (
    <div className="mt-3.5 flex justify-center">
      <a
        href={`${basePath}?${params.toString()}`}
        className="cursor-pointer rounded-lg border border-line px-4 py-1.5 text-xs text-muted transition-colors hover:border-[rgba(var(--goldA),0.4)] hover:text-gold"
      >
        {t.table.nextPage}
      </a>
    </div>
  );
}

/**
 * A section that has no data source yet.
 *
 * Rendered instead of a mocked table. Naming what is missing and why is the only honest
 * option: an operator who opens النزاعات and sees an empty table concludes there are no
 * disputes, which is a different and much worse statement than "this is not built".
 */
export function NotBuilt({ reason }: { reason: string }) {
  return (
    <section className="rounded-[15px] border border-dashed border-[rgba(var(--goldA),0.35)] bg-card p-6">
      <h2 className="text-[14.5px] font-extrabold text-warn">{t.unbuilt.heading}</h2>
      <p className="mt-2.5 max-w-[70ch] text-[12.5px] leading-relaxed text-text2">
        {reason}
      </p>
      <p className="mt-3 text-[11px] text-faint">{t.unbuilt.seeRegister}</p>
    </section>
  );
}

/**
 * The three-way state a queue can be in.
 *
 * Written once because every queue needs it, and because an empty queue and a failed load
 * must never look alike — "nothing to do" and "we could not tell you whether there is
 * anything to do" lead to opposite actions.
 */
export function QueueState<T>({
  state,
  children,
}: {
  state: T[] | 'unauthenticated' | 'failed';
  children: (rows: T[]) => React.ReactNode;
}) {
  if (state === 'failed') {
    return <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>;
  }

  if (state === 'unauthenticated') {
    return <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>;
  }

  if (state.length === 0) {
    return <p className="text-[12.5px] text-faint">{t.dashboard.nothingWaiting}</p>;
  }

  return <ul className="grid gap-2.5">{children(state)}</ul>;
}
