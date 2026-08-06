import type { TableSection } from '@safra/contracts';

import { count } from '@/lib/format';
import { MAX_PAGE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from '@/lib/search-params';
import { fill, t } from '@/lib/strings';

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
  pageParam = 'page',
  sizeParam = 'size',
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
   * `/staff` is that route: the accounts registry and the scope map are both paged lists on one
   * screen. Sharing `?page=` would move them together, so the second one namespaces its
   * parameters — and the first one keeps the plain names, because that is what a URL somebody
   * types or shares should look like.
   */
  readonly pageParam?: string;
  readonly sizeParam?: string;
  /** Overridden on a route with two bars, so the two landmarks are distinguishable. */
  readonly label?: string;
}) {
  const href = (target: number): string => {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(query)) {
      if (value) params.set(key, value);
    }

    params.set(sizeParam, String(size));
    params.set(pageParam, String(target));

    return `${basePath}?${params.toString()}`;
  };

  return (
    <nav
      aria-label={label}
      className="mt-3.5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2.5 border-t border-line pt-3.5 text-[12px] text-muted"
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
            defaultValue={page}
            aria-label={t.table.pageLabel}
            className="w-14 rounded-[9px] border border-line bg-field px-2 py-1.5 text-center text-[12.5px] text-text"
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
            defaultValue={String(size)}
            aria-label={t.table.pageSizeLabel}
            className="cursor-pointer rounded-[9px] border border-line bg-field px-2 py-1.5 text-[12.5px] text-text"
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
          className="inline-flex min-h-10 cursor-pointer items-center rounded-[9px] border border-line px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.4)] hover:text-gold"
        >
          {t.table.apply}
        </button>
      </form>

      <span className="whitespace-nowrap text-faint">
        {fill(capped ? t.table.foundCapped : t.table.found, { n: count(total) })}
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
    <a
      href={href}
      aria-label={label}
      className={`${shape} cursor-pointer border-line text-muted transition-colors hover:border-[rgba(var(--goldA),0.4)] hover:text-gold`}
    >
      <span aria-hidden="true">{glyph}</span>
    </a>
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
