import { seeOther } from '@safra/session';

import {
  TABLE_SECTIONS,
  TABLE_SECTION_PARAMS,
  TABLE_SECTION_PATHS,
  type TableSection,
  isTableSection,
  tablePageSizeSchema,
} from '@safra/contracts';

import { proxy } from '@/lib/proxy';
import { MAX_PAGE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from '@/lib/search-params';

/**
 * Where a request this endpoint cannot make sense of is sent.
 *
 * The dashboard, because it is the one console path that is always valid and always the reader's
 * own. A literal: deriving a destination from a request is what makes a redirector an open
 * redirect, and that is the one thing this route must never do.
 */
const CONSOLE_ROOT = '/';

/**
 * The pagination bar's submit: remember the page size, then show the page that was asked for.
 *
 * ## Why the bar POSTs at all
 *
 * It was a GET form, and a GET that writes to the database is the wrong shape — a prefetch, a
 * bookmark or a link pasted into a chat would silently change somebody's saved preference. So the
 * submit is a POST that writes, and then redirects to the ordinary list URL. The arrows either
 * side of the page number are still plain `<a href>` links, and the URL after the redirect is
 * still shareable, so nothing about the reader's experience depends on this.
 *
 * ## Where the redirect target comes from
 *
 * `/${section}`, with `section` validated against `TABLE_SECTIONS` — a closed list of literals that
 * are also the console's routes. Nothing in the request supplies a path. A redirect built from a
 * caller-supplied `next=` is the classic open redirect, and this endpoint is a redirector, so it
 * is the one thing it must not do.
 *
 * The filters travel as ordinary form fields and are re-encoded through `URLSearchParams`, so a
 * `q` containing `&` or `#` cannot break out of its own parameter.
 *
 * ## Nothing here may answer with a BODY
 *
 * The bar is a plain HTML form, so the browser NAVIGATES to whatever this returns: a JSON body
 * leaves the operator on a bare `{"message":…}` document with no shell, no sidebar and the back
 * button as their only way out. It answered exactly that to five of the console's tables until
 * 2026-08-25 (Bashar, from the screen). Every exit below is a redirect — the same reasoning the
 * partner portal's logout and the customer app's currency switcher already carry, and the same
 * reasoning as `resolvePageSize`: **a display preference is never worth an error page.**
 */
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);

  /*
    Nothing is knowable — not even which table this was — so the only honest destination is the
    console's own root. A literal, because this endpoint is a redirector.
  */
  if (form === null) return seeOther(CONSOLE_ROOT);

  const field = (name: string): string | undefined => {
    const value = form.get(name);

    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  };

  /*
    The SECTION first, alone, because the size field's NAME depends on it.

    This was one `safeParse` of `{ section, size: field('size') }`, and `'size'` is the literal
    name only a non-namespaced table posts. The five namespaced ones — the two verification
    queues, آخر نشاط الموظفين, a partner's violations and the staff scope map — post `queueSize`,
    `activitySize`, `vsize` and `scopeSize`, so `field('size')` was `undefined` for every one of
    them and the parse failed on a request that was perfectly well formed. Both controls in the bar
    live in one form, so a page number typed into a namespaced table died the same way.

    `listParamsFor` had already learned this lesson on the READ side, in almost these words: it
    "took a section and then ignored it for the parameter names". This is the write side of the
    same mistake, and the fix is the same map.
  */
  const candidate = field('section');

  if (!isTableSection(candidate)) return seeOther(CONSOLE_ROOT);

  const section = candidate;
  const names = TABLE_SECTION_PARAMS[section];

  const parsed = tablePageSizeSchema.safeParse({ section, size: field(names.size) });

  /*
    An unusable size is IGNORED, not refused.

    `undefined` here means the redirect carries no size at all, and `resolvePageSize` then falls
    through to the size this reader has saved for this table — which is what they were already
    looking at. Substituting a default instead would silently shrink somebody's hundred-row audit
    view because one request was malformed, and refusing outright is the error page this route
    exists to stop. The select only offers 10/25/50/100, so this is a hand-made request either way.
  */
  const size = parsed.success ? parsed.data.size : undefined;

  /*
    Saved, and a failure is swallowed on purpose. The reader asked to SEE a page; if remembering
    the choice fails they should still get the page they asked for, at the size they asked for.
    The preference simply does not stick, which the next render shows honestly.

    Only a size that PARSED is written. A junk value must not reach `users.table_page_sizes`: the
    API validates it against the same contract and would refuse, and a preference nobody can read
    back is worse than one that was never written.
  */
  if (size !== undefined) {
    await proxy('/admin/me/preferences/table-page-size', {
      method: 'PATCH',
      body: { section, size },
    }).catch(() => null);
  }

  /*
    A RELATIVE Location. `NextResponse.redirect` needs an absolute URL and would build it from
    `request.url`, which the standalone server derives from the address it is BOUND to — so in a
    container every one of these sent the operator to `http://0.0.0.0:3001/…`, a different origin
    the session cookie does not reach. See `seeOther`.
  */
  const target = listUrl(request, section, size, field);

  /*
    The fragment lands the reader on the BAR they just submitted (Bashar, 2026-08-24).

    A redirect is a full navigation and the browser resets scroll, so applying a page number or a
    new size at the foot of a long table threw the reader to the top of the page — the same
    complaint as the arrows, arriving by a different route. The arrows are `<Link scroll={false}>`,
    which no form submit can be; a fragment is the only mechanism a POST-and-redirect has.

    Named per SECTION and built from the ALLOW-LISTED section, never from the request — this
    endpoint is a redirector, and a fragment taken from a caller would be caller-controlled content
    in a URL the console then trusts. `TablePagination` writes the same id onto its `<nav>`.
  */
  return seeOther(`${target.pathname}${target.search}#pager-${section}`);
}

/**
 * The list URL to land on: a literal path, plus the filters the bar was carrying.
 *
 * `page` and `size` are clamped here as well as validated above — the same reasoning the rest of
 * the console applies to a hand-edited URL. A `?page=0` should show page one, not an error.
 *
 * `size` is optional: absent means "say nothing about the size", which leaves the reader's saved
 * preference in force rather than overruling it with a guess. See the call site.
 */
function listUrl(
  request: Request,
  section: TableSection,
  size: number | undefined,
  field: (name: string) => string | undefined,
): URL {
  const url = new URL(TABLE_SECTION_PATHS[section], request.url);
  /*
    The parameter NAMES come from the section too, not from the form. `/staff` carries two paged
    tables and the second namespaces its parameters; letting the request name them would let it
    write a parameter of its choosing into a URL the console then trusts.
  */
  const names = TABLE_SECTION_PARAMS[section];

  const page = Number(field(names.page));
  const clampedPage = Number.isFinite(page)
    ? Math.min(MAX_PAGE, Math.max(1, Math.trunc(page)))
    : 1;

  if (clampedPage > 1) url.searchParams.set(names.page, String(clampedPage));

  if (size !== undefined) {
    url.searchParams.set(
      names.size,
      String(Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, size))),
    );
  }

  for (const name of ['q', 'status']) {
    const value = field(name);

    if (value !== undefined) url.searchParams.set(name, value);
  }

  /*
    The OTHER table's place on a two-table screen (2026-08-25, found in a browser).

    `/staff`, `/partners` and `/properties` each carry two paged lists, and each bar's form posts the
    other one's `page`/`size` as hidden fields precisely so they survive a submit. This loop only
    copied `q` and `status`, so applying a size to the activity panel silently threw the accounts
    registry beneath it back to page one — «كل paging control carries the filters forward» failing in
    the one place two tables make it hard to notice, because the list that moved is not the list the
    reader was touching.

    The names come from `TABLE_SECTION_PARAMS`, never from the form, so this is still a closed set of
    server-side literals rather than "whatever the request happened to send". And the values are
    parsed as NUMBERS and clamped, so nothing a caller writes reaches the URL as text — the same
    reasoning `returnQuery` applies to a row link.
  */
  /*
    This section's OWN names are excluded BY NAME, not by whether they were already set.

    Sixteen sections share the plain `page`/`size`, so `other !== section` is not enough to tell a
    sibling's parameter from this one's — and `page` is deliberately omitted above when it is 1, so
    testing `searchParams.has()` would let the sibling loop put `?page=1` back for the very table
    that just decided not to write it.
  */
  const own = new Set([names.page, names.size]);

  for (const other of TABLE_SECTIONS) {
    const sibling = TABLE_SECTION_PARAMS[other];

    for (const [name, clamp] of [
      [sibling.page, (n: number) => Math.min(MAX_PAGE, Math.max(1, n))],
      [sibling.size, (n: number) => Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, n))],
    ] as const) {
      if (own.has(name) || url.searchParams.has(name)) continue;

      const raw = Number(field(name));

      if (!Number.isFinite(raw)) continue;

      url.searchParams.set(name, String(clamp(Math.trunc(raw))));
    }
  }

  return url;
}
