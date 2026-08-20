import { NextResponse } from 'next/server';

import { seeOther } from '@safra/session';

import {
  TABLE_SECTION_PARAMS,
  TABLE_SECTION_PATHS,
  type TableSection,
  tablePageSizeSchema,
} from '@safra/contracts';

import { proxy } from '@/lib/proxy';
import { MAX_PAGE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from '@/lib/search-params';

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
 * `/${section}`, with `section` validated against `TABLE_SECTIONS` — fourteen literals that are
 * also the console's routes. Nothing in the request supplies a path. A redirect built from a
 * caller-supplied `next=` is the classic open redirect, and this endpoint is a redirector, so it
 * is the one thing it must not do.
 *
 * The filters travel as ordinary form fields and are re-encoded through `URLSearchParams`, so a
 * `q` containing `&` or `#` cannot break out of its own parameter.
 */
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);

  if (form === null) {
    return NextResponse.json({ message: 'Malformed request.' }, { status: 400 });
  }

  const field = (name: string): string | undefined => {
    const value = form.get(name);

    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  };

  const parsed = tablePageSizeSchema.safeParse({
    section: field('section'),
    size: field('size'),
  });

  if (!parsed.success) {
    return NextResponse.json({ message: 'Unknown table or size.' }, { status: 400 });
  }

  const { section, size } = parsed.data;

  /*
    Saved, and a failure is swallowed on purpose. The reader asked to SEE a page; if remembering
    the choice fails they should still get the page they asked for, at the size they asked for.
    The preference simply does not stick, which the next render shows honestly.
  */
  await proxy('/admin/me/preferences/table-page-size', {
    method: 'PATCH',
    body: { section, size },
  }).catch(() => null);

  /*
    A RELATIVE Location. `NextResponse.redirect` needs an absolute URL and would build it from
    `request.url`, which the standalone server derives from the address it is BOUND to — so in a
    container every one of these sent the operator to `http://0.0.0.0:3001/…`, a different origin
    the session cookie does not reach. See `seeOther`.
  */
  const target = listUrl(request, section, size, field);

  return seeOther(`${target.pathname}${target.search}`);
}

/**
 * The list URL to land on: a literal path, plus the filters the bar was carrying.
 *
 * `page` and `size` are clamped here as well as validated above — the same reasoning the rest of
 * the console applies to a hand-edited URL. A `?page=0` should show page one, not an error.
 */
function listUrl(
  request: Request,
  section: TableSection,
  size: number,
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

  url.searchParams.set(
    names.size,
    String(Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, size))),
  );

  for (const name of ['q', 'status']) {
    const value = field(name);

    if (value !== undefined) url.searchParams.set(name, value);
  }

  return url;
}
