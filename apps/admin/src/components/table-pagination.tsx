import Link from 'next/link';

import { TABLE_SECTION_PARAMS, type TableSection } from '@safra/contracts';

import { count } from '@/lib/format';
import { barState } from './table-pagination-state';
import { MAX_PAGE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from '@/lib/search-params';
import { fill, t, plural } from '@/lib/strings';

/**
 * The bar under every table: page number, page count, rows per page, total found.
 *
 * ```
 *              ٢٥٣١ نتيجة      اعرض [٢٥ ▾] صفًا      صفحة ›  [١]  ‹ من ١٠٢
 * ```
 *
 * Specified by Bashar (2026-08-05) from a screenshot of the same bar in German, and placed
 * directly under the table rather than above it, as asked.
 *
 * ## Why a page NUMBER, and what it cost
 *
 * Every registry ran on a keyset cursor before this, which is the cheaper and more correct
 * mechanism — and which cannot address a page. "صفحة ٤ من ١٠٢" and a box to jump to page ٤٠ are
 * only expressible with `OFFSET` and a `count(*)`, so the whole API moved. The trade, the cost and
 * the cap on the count are set out in `packages/contracts/src/pagination.ts`; this component is
 * the reason the trade was made.
 *
 * ## Why the arrows are links and the number is a form
 *
 * A step is a destination, so it is an `<a href>` — middle-clickable, bookmarkable, and it works
 * with the keyboard for free. Typing a page or picking a size is input, so those live in a GET
 * form. Both carry the current filters forward: paging out of a filtered view is the bug this
 * shape exists to prevent.
 *
 * ## Why there is a تطبيق button
 *
 * The screenshot has none — its select applies on change, which is JavaScript. This console
 * renders on the server and its forms work without it, so the alternative to a visible submit is
 * a control that needs a keystroke the reader cannot see. That is the same reasoning the search
 * toolbar already follows, and one small button is the honest cost of a form that always works.
 */
export function TablePagination({
  basePath,
  section,
  query,
  page,
  pages,
  total,
  capped,
  size,
  label = t.table.paginationLabel,
}: {
  readonly basePath: string;
  /**
   * Which registry this is, so the chosen size can be remembered against the ACCOUNT.
   *
   * One of the fourteen literals in `TABLE_SECTIONS`, which is also what the save endpoint builds
   * its redirect from — so the section names a table, never a path.
   */
  readonly section: TableSection;
  /** Current filters, carried into every link and hidden in the form. */
  readonly query: Record<string, string | undefined>;
  readonly page: number;
  readonly pages: number;
  readonly total: number;
  /** True when the total stopped at the count cap — printed as "more than". */
  readonly capped: boolean;
  readonly size: number;
  /**
   * The URL parameter names, for a route with TWO paged tables.
   *
   * Three routes are like that — `/staff`, `/partners` and `/properties` — each carrying a registry
   * and a second paged list. Sharing `?page=` would move them together, so the second one
   * namespaces its parameters and the first keeps the plain names, because that is what a URL
   * somebody types or shares should look like.
   */
  /** Overridden on a route with two bars, so the two landmarks are distinguishable. */
  readonly label?: string;
}) {
  /*
    The parameter names come from the SECTION, not from a prop.
    
    They were `pageParam`/`sizeParam` props defaulting to `page`/`size`, and `scope-panel.tsx` was
    the only caller that passed them. That made the namespacing a thing each call site had to
    remember — and the first two callers to forget it were the verification queues added on
    2026-08-20, whose bars would have paged the REGISTRY they sit beside rather than themselves.
    
    `TABLE_SECTION_PARAMS` is the same map the save endpoint derives its redirect from, so the bar,
    the page that reads the query string, and the endpoint that writes the preference now all answer
    "what is this table's page parameter" from one place.
  */
  const { page: pageParam, size: sizeParam } = TABLE_SECTION_PARAMS[section];
  /** One per section, so the two bars on `/staff` cannot send a reader to each other. */
  const anchorId = `pager-${section}`;

  /*
    A control that cannot change anything is DISABLED, not merely ignored (Bashar, 2026-08-25).

    He met this on a table with two rows in it: both arrows correctly greyed, and beside them a page
    box still inviting a number and a تطبيق still inviting a press. Typing 2 and pressing it was the
    request that produced the JSON screen — but even with that fixed, a live control on a table with
    one page is a promise the screen cannot keep, which is the same class of defect as a capability
    with no feature behind it.

    Disabled rather than REMOVED, because the bar's five parts are a standing instruction of his own
    (2026-08-05): the same bar under every list, so a reader recognises it. A control that vanishes on
    small tables and returns on large ones is a different bar.

    The DECISION is `barState`, and it is a function so it can be asked directly — see the note there
    on the one case a browser test cannot reach on a development database.
  */
  const { onlyPage, sizeIsMoot, nothingToApply } = barState({
    pages,
    total,
    capped,
    smallestSize: SIZES[0],
  });
  const href = (target: number): string => {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(query)) {
      if (value) params.set(key, value);
    }

    params.set(sizeParam, String(size));
    params.set(pageParam, String(target));

    /*
      The fragment is the NO-JAVASCRIPT half of "do not scroll" (Bashar, 2026-08-24).

      `<Link scroll={false}>` keeps the viewport still when JavaScript is running, which is what was
      asked for. When it is not, `<Link>` is an ordinary anchor and the browser resets scroll — so
      the href names the bar and the reader lands on the control they just pressed rather than at
      the top of the page. Two mechanisms for two runtimes, and neither is a fallback for a bug in
      the other.

      Named per SECTION because two bars share a route on `/staff` — a single `#pager` would send
      one bar's reader to the other's.
    */
    return `${basePath}?${params.toString()}#${anchorId}`;
  };

  return (
    <nav
      id={anchorId}
      aria-label={label}
      /*
        `scroll-mt-24` so a fragment landing does not put the bar flush against the viewport edge —
        the same allowance every row anchor makes, for the same reason.
      */
      className="mt-3.5 scroll-mt-24 flex flex-wrap items-center justify-center gap-x-6 gap-y-2.5 border-t border-line pt-3.5 text-[12px] text-muted"
    >
      {/*
        `page` and `size` both live in this form, so submitting either one keeps the other. The
        hidden fields carry the filters: a form posts only its own fields, and a bar that dropped
        `?q=` would silently widen the set the reader is looking at.
      */}
      {/*
        Three GROUPS that wrap as units, rather than nine items that wrap individually.

        At 390px a single non-wrapping row squeezed «صفحة» into its own arrow. Letting the nine
        controls wrap freely is no better — it breaks «من ٤٣٤» away from the page it belongs to and
        the bar stops reading as a sentence. So each group holds together and the groups stack.
      */}
      {/*
        POST, not GET, because submitting this bar REMEMBERS the size against the reader's account
        (Bashar, 2026-08-06) — and a GET that writes would let a prefetch or a pasted link change
        somebody's preference. The route saves, then redirects to the ordinary list URL, so what
        the reader ends up looking at is still a plain shareable GET. The arrows either side of the
        page number are still `<a href>`.
      */}
      <form
        action="/api/table-page-size"
        method="post"
        className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2"
      >
        <input type="hidden" name="section" value={section} />

        {Object.entries(query).map(([key, value]) =>
          value && key !== pageParam && key !== sizeParam ? (
            <input key={key} type="hidden" name={key} value={value} />
          ) : null,
        )}

        <span className="flex items-center gap-2">
          <span className="whitespace-nowrap">{t.table.page}</span>

          <Step
            href={href(page - 1)}
            label={t.table.previousPage}
            enabled={page > 1}
            glyph="→"
          />

          <input
            type="number"
            name={pageParam}
            inputMode="numeric"
            min={1}
            max={MAX_PAGE}
            /*
              `key` so the number actually CHANGES when the page does (Bashar, 2026-08-24).

              This is uncontrolled — `defaultValue` is read once, when React mounts the node. That
              was fine while the arrows were plain anchors: every step was a document load, the DOM
              was rebuilt, and the box showed the new page.

              Making the arrows `<Link scroll={false}>` to stop the viewport jumping turned each
              step into a SOFT navigation. React then reconciles the same `<input>` rather than
              replacing it, `defaultValue` is not re-applied, and the box keeps the page the reader
              arrived on while the list beneath it moves. «صفحة ١ من ١٠٢» over the contents of page
              four — the bar contradicting the table it describes, which is exactly the class of
              failure the shared `fromWhere` rule exists to prevent one layer down.

              Keying on the value forces a remount when it changes, which is the smallest fix that
              keeps the input uncontrolled — and it must stay uncontrolled, because a controlled one
              would fight the reader mid-type on every keystroke.

              My regression, from the scroll fix, three hours earlier.
            */
            key={`page-${page}`}
            defaultValue={page}
            aria-label={t.table.pageLabel}
            /*
              One page means one legal value, so the box is read-only rather than a form field that
              accepts a number and then declines to go there. `disabled` also takes it out of the
              submitted form, which is what stops the endpoint being asked for page 2 of 1.
            */
            disabled={onlyPage}
            className="w-14 rounded-[9px] border border-line bg-field px-2 py-1.5 text-center text-[12.5px] text-text disabled:cursor-not-allowed disabled:opacity-40"
          />

          <Step
            href={href(page + 1)}
            label={t.table.nextPageShort}
            enabled={page < pages}
            glyph="←"
          />

          <span className="whitespace-nowrap">
            {fill(t.table.pageOf, { n: count(pages) })}
          </span>
        </span>

        <label className="flex items-center gap-2">
          <span className="whitespace-nowrap">{t.table.show}</span>
          <select
            name={sizeParam}
            /* Same reason as the page box: uncontrolled, and a soft navigation does not remount it. */
            key={`size-${size}`}
            defaultValue={String(size)}
            aria-label={t.table.pageSizeLabel}
            /* Only when every option would show the same rows — see `sizeIsMoot`. */
            disabled={sizeIsMoot}
            className="cursor-pointer rounded-[9px] border border-line bg-field px-2 py-1.5 text-[12.5px] text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sizeOptions(size).map((option) => (
              <option key={option} value={option}>
                {count(option)}
              </option>
            ))}
          </select>
          <span className="whitespace-nowrap">{t.table.rows}</span>
        </label>

        <button
          type="submit"
          disabled={nothingToApply}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-[9px] border border-line px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.4)] hover:text-gold disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-muted"
        >
          {t.table.apply}
        </button>
      </form>

      {/*
        Why the controls are dead, said rather than left to be inferred.

        Four greyed controls with no explanation read as a broken screen; the same four with a line
        saying everything is already on one page read as a screen that has nothing left to do. It is
        `role="status"` rather than plain text because it appears and disappears as a table grows
        past its page size, and a change nobody is told about is a change a screen-reader user meets
        by finding a control they were using has stopped responding.
      */}
      {onlyPage ? (
        <span role="status" className="whitespace-nowrap text-faint">
          {t.table.singlePage}
        </span>
      ) : null}

      {/*
        `data-table-total` so a browser sweep finds the TOTAL and nothing else.

        The same reasoning as `data-status-pill`: the total was found by matching Arabic text on the
        root «نتيج», which any neighbouring sentence mentioning results also answers to — and one
        did, the day the single-page note was added. A marker names the element rather than hoping
        its wording stays unique.
      */}
      <span data-table-total className="whitespace-nowrap text-faint">
        {plural(capped ? t.table.foundCapped : t.table.found, { n: total })}
      </span>
    </nav>
  );
}

/**
 * One step arrow.
 *
 * Disabled renders as a `<span>` rather than a greyed link, because a link that goes nowhere is
 * still focusable and still announced as a link — and page 0 is a URL that should not exist.
 *
 * The glyphs point the way the reader is going: this console is RTL, so BACK is `→` and FORWARD
 * is `←`. They are `aria-hidden`, and the accessible name is the word beside them — an arrow read
 * aloud is "rightwards arrow", which tells nobody which page they are about to land on.
 *
 * `→`/`←` and NOT the chevrons `›`/`‹` the design uses, because those carry Unicode's
 * `Bidi_Mirrored` property: a `‹` written here renders as `›` inside an RTL container, so the code
 * would say the opposite of the screen and the next person to read it would "fix" it back. The
 * arrows are not mirrored, so what is written is what is shown.
 */
function Step({
  href,
  label,
  enabled,
  glyph,
}: {
  readonly href: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly glyph: string;
}) {
  /*
    40px on handheld, 32px from `lg` up.

    The console's 40px floor is a `:where()` rule over `button`/`select`/`summary` — an anchor is
    inline, so `min-height` alone does nothing to it, and the convention is that anchors styled as
    controls carry the size themselves. The design's dense desktop bar (§9.4) is what is wanted
    once the pointer is a mouse, which is where `lg` puts the boundary — the same breakpoint at
    which the sidebar stops being a drawer.
  */
  const shape =
    'inline-flex h-10 w-10 items-center justify-center rounded-[9px] border text-[15px] leading-none lg:h-8 lg:w-8';

  if (!enabled) {
    return (
      <span aria-disabled="true" className={`${shape} border-line text-faint opacity-40`}>
        <span aria-hidden="true">{glyph}</span>
      </span>
    );
  }

  return (
    /*
      `scroll={false}`, because paging is not arriving somewhere — it is staying (Bashar, 2026-08-24).

      A plain `<a href>` is a full navigation and the browser resets scroll, so pressing «التالي» at
      the foot of a long table threw the reader to the top of the page and left them scrolling back
      down to the bar they had just used. The row they were reading, the filters they had set and
      the control under their finger all went off-screen for a step that changed nothing about where
      they were.

      The href still carries a fragment, and the two answers do not conflict: with JavaScript
      `scroll={false}` wins and the viewport does not move at all, which is what was asked for.
      Without it, `<Link>` degrades to an ordinary anchor, the browser follows the fragment, and the
      reader lands at the table instead of the page top — worse than not moving, better than today.
      Middle-click, bookmarking and keyboard focus all survive either way.
    */
    <Link
      href={href}
      scroll={false}
      aria-label={label}
      className={`${shape} cursor-pointer border-line text-muted transition-colors hover:border-[rgba(var(--goldA),0.4)] hover:text-gold`}
    >
      <span aria-hidden="true">{glyph}</span>
    </Link>
  );
}

/** The offered sizes, plus whatever is in force — a hand-edited `?size=7` must show as 7. */
const SIZES = [10, 25, 50, 100] as const;

function sizeOptions(size: number): number[] {
  const clamped = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, size));

  return SIZES.includes(clamped as (typeof SIZES)[number])
    ? [...SIZES]
    : [...SIZES, clamped].sort((a, b) => a - b);
}
