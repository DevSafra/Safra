import type { ReactNode } from 'react';

import { t } from '@/lib/strings';

/**
 * The row above every admin table: search, filters, a count, an action.
 *
 * Handoff §8 makes a search input mandatory on every admin table, with exact metrics:
 * `var(--field)` background, `1px solid var(--line)`, 9px radius, 8px/14px padding, 12.5px,
 * min-width 260px (230px on the narrower sections — both appear in the prototype; 260px is
 * used here for consistency, and the difference is 30px of an input that is `flex` anyway).
 *
 * ## Search runs in SQL, not in the browser
 *
 * A documented deviation (`docs/design-gap-report.md` §6). The handoff describes filtering as
 * "a case-insensitive substring match across all string fields of a row", which is right for
 * a hard-coded array of six demo rows. These tables hold thousands of rows and are paginated,
 * so a client-side filter would silently search only the page in front of you and report
 * "no results" for a row that exists — worse than having no search at all.
 *
 * So this is a plain GET form. It works without JavaScript, the query lands in the URL (which
 * makes a filtered view shareable and bookmarkable, something the prototype cannot do), and
 * the server does the matching against an indexed column.
 */
export function TableToolbar({
  action,
  query,
  size,
  placeholder,
  children,
  end,
  below,
  queryName = 'q',
  sizeName = 'size',
  carry,
}: {
  /** Where the form submits — normally the section's own path. */
  readonly action: string;
  readonly query: string | undefined;
  /** Current rows per page, carried through the search so a submit does not reset it. */
  readonly size: number;
  /** Arabic placeholder, verbatim from the handoff. */
  readonly placeholder: string;
  /** Extra controls that belong INSIDE the form, e.g. a status select. */
  readonly children?: ReactNode;
  /** Controls outside the form, pushed to the far end — a count line, an export button. */
  readonly end?: ReactNode;
  /**
   * A panel that opens UNDER the bar, at the full width of the table.
   *
   * `end` cannot serve this: its wrapper is `ms-auto` and sizes to its content, so a `w-full` child
   * resolves to the content width and a form placed there renders in a third of the row with the
   * search beside it. A panel is not a control at the end of a line — it is a row of its own.
   */
  readonly below?: ReactNode;
  /**
   * The parameter names, for the SECOND paged table on a route.
   *
   * `/ads` carries two — the campaign registry and فواتير الإعلانات beneath it — and they must not
   * share `?q=` or `?size=`, for the same reason `TABLE_SECTION_PARAMS` namespaces `?page=`:
   * searching one would silently filter the other. Defaulted, so the twenty single-table sections
   * are unchanged and nothing has to be remembered at those call sites.
   */
  readonly queryName?: string;
  readonly sizeName?: string;
  /**
   * The OTHER table's position on this route, carried as hidden fields.
   *
   * A form posts only its own fields, so a search here would otherwise drop the neighbour's page
   * and size — the «bar that drops its neighbour's page» defect, in the search direction. Both
   * bars carry the other's, because fixing the half you are looking at leaves the other half live.
   */
  readonly carry?: Readonly<Record<string, string | undefined>>;
}) {
  return (
    <div className="mb-3.5 grid gap-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <form
          action={action}
          method="get"
          className="flex flex-wrap items-center gap-2.5"
        >
          {children}

          {/*
            The chosen size travels with the search as a hidden field.
            Without it, submitting a search would drop `?size=` and quietly reset the table to 25
            rows — the size control now lives in the bar UNDER the table, so this form has no visible
            size input to carry it.
          */}
          <input type="hidden" name={sizeName} value={String(size)} />

          {/* The neighbouring table's place, so searching this one does not move that one. */}
          {Object.entries(carry ?? {}).map(([key, value]) =>
            value ? <input key={key} type="hidden" name={key} value={value} /> : null,
          )}

          <input
            type="search"
            name={queryName}
            defaultValue={query ?? ''}
            placeholder={placeholder}
            aria-label={placeholder}
            className="min-w-[260px] rounded-lg border border-line bg-field px-3.5 py-2 text-[12.5px] text-text placeholder:text-faint"
          />

          {/*
            A visible submit, not an Enter-only form. The handoff's input filters as you type;
            this one submits, and a control that needs a keystroke the user cannot see is an
            accessibility failure as well as a discoverability one.
          */}
          <button
            type="submit"
            className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-3.5 py-2 text-[12.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.4)] hover:text-gold"
          >
            {t.table.search}
          </button>
        </form>

        {end ? (
          <div className="ms-auto flex flex-wrap items-center gap-2.5">{end}</div>
        ) : null}
      </div>

      {below}
    </div>
  );
}

/** The gold-outline secondary action the handoff uses for تصدير CSV and + إضافة … */
export function OutlineAction({
  href,
  children,
  download,
}: {
  readonly href: string;
  readonly children: ReactNode;
  readonly download?: boolean;
}) {
  return (
    <a
      href={href}
      {...(download ? { download: '' } : {})}
      className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-[rgba(var(--goldA),0.35)] px-4 py-1.5 text-xs font-bold text-gold-ink transition-colors hover:bg-[rgba(var(--goldA),0.08)]"
    >
      {children}
    </a>
  );
}

/**
 * The gold gradient primary button (§9.3), as a link.
 *
 * `linear-gradient(135deg,#F0CB7C,#C4923E)` with `#241A05` text — identical in both themes,
 * and reserved for primary actions only.
 */
export function GoldAction({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-[linear-gradient(135deg,#F0CB7C,#C4923E)] px-5 py-2 text-[12.5px] font-extrabold text-[#241A05] transition-opacity hover:opacity-90"
    >
      {children}
    </a>
  );
}

/** The count / context line the handoff puts beside the search on several sections. */
export function ToolbarNote({ children }: { children: ReactNode }) {
  return <span className="text-xs text-faint">{children}</span>;
}
