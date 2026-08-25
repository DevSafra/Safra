import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TABLE_SECTIONS, TABLE_SECTION_PARAMS } from '@safra/contracts';

/**
 * The rows-per-page bar's submit, for every table the console has.
 *
 * ## The defect this exists for
 *
 * Bashar, 2026-08-25, from the screen: choosing 25 rows on a table with two rows in it — or typing
 * a page number — answered a bare JSON document reading «Unknown table or size.». Not an error
 * page inside the console: a raw body, no shell, no sidebar, the back button the only way out.
 *
 * The cause was that the route read `field('size')` — the literal name — while the bar posts the
 * name that belongs to the SECTION. Five of the console's tables namespace theirs, because they
 * share a route with a registry that already owns `?page=`: the two verification queues post
 * `queueSize`, آخر نشاط الموظفين posts `activitySize`, a partner's violations posts `vsize` and the
 * staff scope map posts `scopeSize`. For all five, `field('size')` was `undefined` and a perfectly
 * well-formed submission failed validation. Both controls live in one form, so the page number died
 * with it — which is why Bashar met it twice, by two routes, on the same bar.
 *
 * ## Why the loop runs over EVERY section rather than the five that were broken
 *
 * A test naming the five would have passed the day before the sixth namespaced table was added.
 * `TABLE_SECTIONS` and `TABLE_SECTION_PARAMS` are the same maps the bar and the route both read,
 * so driving the test from them means a table added tomorrow is covered by this file today. The
 * two non-namespaced sections are in the loop for the same reason the falsification below matters:
 * without them, a route that answered 303 to nothing at all would look correct here.
 *
 * ## Watched to fail
 *
 * Against the previous route, every namespaced section returned 400 and every plain one returned
 * 303 — the exact split the defect predicts. See the report for the run.
 */
const proxy = vi.fn(() => Promise.resolve(null));

vi.mock('@/lib/proxy', () => ({ proxy }));

const { POST } = await import('./route.js');

/** A submission shaped the way `TablePagination` shapes it: the section's OWN parameter names. */
function submit(fields: Record<string, string>): Request {
  const body = new URLSearchParams(fields);

  return new Request('http://console.test/api/table-page-size', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}

describe('the rows-per-page bar', () => {
  beforeEach(() => {
    proxy.mockClear();
  });

  it.each(TABLE_SECTIONS)(
    'sends %s back to its own list, never a body',
    async (section) => {
      const names = TABLE_SECTION_PARAMS[section];

      const response = await POST(
        submit({ section, [names.page]: '2', [names.size]: '25' }),
      );

      expect(response.status).toBe(303);

      /*
      The assertion that catches the reported defect. A 400 carried `content-type:
      application/json`, which is the JSON screen itself — so the absence of a body type is the
      thing worth asserting, not merely the status.
    */
      expect(response.headers.get('content-type')).toBeNull();

      const location = response.headers.get('location');

      expect(location).not.toBeNull();
      expect(location).toContain(`${names.size}=25`);
      expect(location).toContain(`${names.page}=2`);
      /* The reader lands on the bar they just used, not at the top of the page. */
      expect(location).toContain(`#pager-${section}`);
    },
  );

  it.each(TABLE_SECTIONS)('remembers the chosen size for %s', async (section) => {
    const names = TABLE_SECTION_PARAMS[section];

    await POST(submit({ section, [names.size]: '50' }));

    expect(proxy).toHaveBeenCalledWith('/admin/me/preferences/table-page-size', {
      method: 'PATCH',
      body: { section, size: 50 },
    });
  });

  /**
   * The opposite control.
   *
   * Every assertion above would also pass on a route that answered 303 to absolutely everything,
   * including a request naming a table that does not exist — which is the open-redirect shape this
   * endpoint is built to refuse. So: an unknown section must not reach a list URL, and must not
   * write a preference either.
   */
  it('refuses a section that is not on the allow-list, without a body', async () => {
    const response = await POST(submit({ section: '../../etc', size: '25' }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
    expect(response.headers.get('content-type')).toBeNull();
    expect(proxy).not.toHaveBeenCalled();
  });

  it('ignores an unusable size rather than refusing, and does not save it', async () => {
    const response = await POST(submit({ section: 'bookings', page: '3', size: 'lots' }));

    expect(response.status).toBe(303);

    const location = response.headers.get('location');

    /*
      No size at all in the redirect. `resolvePageSize` then falls through to what this reader has
      saved for this table — leaving them where they were, rather than shrinking their view to ten
      because one field was junk.
    */
    expect(location).toContain('page=3');
    expect(location).not.toContain('size=');
    expect(proxy).not.toHaveBeenCalled();
  });

  /**
   * The OTHER table's position on a two-table screen.
   *
   * Found in a browser on 2026-08-25, not by any of the assertions above: applying a size to آخر
   * نشاط الموظفين dropped `page`/`size` from the redirect, so the accounts registry underneath it
   * silently went back to page one. The redirect only forwarded `q` and `status`.
   *
   * The direction matters in both senses, so both are asserted: a sibling's parameters must SURVIVE,
   * and this section's own `page` must still be omitted when it is 1 rather than being put back by
   * the loop that forwards the siblings.
   */
  it("keeps the sibling table's place on a two-table screen", async () => {
    const response = await POST(
      submit({
        section: 'staffActivity',
        activityPage: '2',
        activitySize: '25',
        /* What the activity panel's form carries as hidden fields: the registry's own place. */
        page: '3',
        size: '50',
      }),
    );

    const location = response.headers.get('location') ?? '';

    expect(location).toContain('activityPage=2');
    expect(location).toContain('activitySize=25');
    expect(location).toContain('page=3');
    expect(location).toContain('size=50');
  });

  it('does not put back a page number of 1 that it deliberately omitted', async () => {
    const response = await POST(submit({ section: 'staff', page: '1', size: '25' }));

    const location = response.headers.get('location') ?? '';

    /* `page=1` is the default, and a URL somebody shares should not carry it. */
    expect(location).not.toContain('page=1');
    expect(location).toContain('size=25');
  });

  it('clamps a sibling parameter rather than copying what was sent', async () => {
    const response = await POST(
      submit({
        section: 'staffActivity',
        activitySize: '25',
        /* Out of range, and not a number. Neither may reach the URL as written. */
        queueSize: '5000',
        vpage: 'drop',
      }),
    );

    const location = response.headers.get('location') ?? '';

    expect(location).toContain('queueSize=100');
    expect(location).not.toContain('5000');
    expect(location).not.toContain('drop');
  });

  /**
   * A page beyond the last one is clamped to the last one (Bashar, 2026-08-25).
   *
   * The bar posts how many pages it was showing, so deleting the `disabled` attribute in DevTools
   * and asking for page 2 of one page lands back on page 1 — no `page` in the redirect at all,
   * which is what "nothing happens" looks like in a URL.
   */
  it('clamps a page beyond the declared last page', async () => {
    const response = await POST(
      submit({ section: 'reviews', page: '2', size: '25', pages: '1' }),
    );

    const location = response.headers.get('location') ?? '';

    expect(location).not.toContain('page=');
    expect(location).toContain('size=25');
  });

  it('lets a real page through when the table has the pages', async () => {
    const response = await POST(
      submit({ section: 'bookings', page: '3', size: '25', pages: '40' }),
    );

    expect(response.headers.get('location')).toContain('page=3');
  });

  it('ignores a declared ceiling that is not a number, rather than trusting it', async () => {
    /*
      `pages` comes from the form, so it is not a boundary — but a junk value must not become one
      either. Falling back to `MAX_PAGE` keeps the pre-existing behaviour for a hand-made request.
    */
    const response = await POST(
      submit({ section: 'bookings', page: '3', size: '25', pages: 'lots' }),
    );

    expect(response.headers.get('location')).toContain('page=3');
  });

  /**
   * A submit that could not change anything does NOTHING (Bashar, 2026-08-25, second report).
   *
   * On مخالفات in the console the section's path is `/partners` — the registry — because
   * `TABLE_SECTION_PATHS` cannot hold a URL containing a record reference. That trade is right for a
   * real submit and wrong for one that changes nothing: deleting the `disabled` attribute and
   * pressing تطبيق took him off the violations he was reading and onto الشركاء.
   *
   * `204` and no `Location`, so the browser stays exactly where it is. Not a redirect back to the
   * same URL: that is a navigation, it resets scroll, and it is a lie about something having happened.
   */
  it('answers a submit with nothing to apply by doing nothing', async () => {
    const response = await POST(
      submit({
        section: 'partnerViolations',
        vpage: '2',
        vsize: '25',
        /* One page, two rows — the state where every control is dead. */
        pages: '1',
        total: '2',
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('content-type')).toBeNull();
    /* And nothing was written, because nothing was chosen. */
    expect(proxy).not.toHaveBeenCalled();
  });

  /**
   * The opposite control, in both directions — without these the fix above is indistinguishable
   * from an endpoint that has simply stopped working.
   */
  it('still applies a size when the table is one page but larger than the smallest size', async () => {
    const response = await POST(
      submit({ section: 'audit', size: '100', pages: '1', total: '40' }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('size=100');
    expect(proxy).toHaveBeenCalled();
  });

  it('still applies on a table with several pages', async () => {
    const response = await POST(
      submit({ section: 'bookings', page: '3', size: '25', pages: '40', total: '900' }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('page=3');
  });

  it('acts normally when the bar sent no counts at all', async () => {
    /* Every caller that is not the bar — a script, an old cached page — keeps working. */
    const response = await POST(submit({ section: 'bookings', size: '25' }));

    expect(response.status).toBe(303);
    expect(proxy).toHaveBeenCalled();
  });

  it('treats a capped total as never moot, so a huge table is never inert', async () => {
    const response = await POST(
      submit({ section: 'audit', size: '25', pages: '1', total: '10', capped: '1' }),
    );

    expect(response.status).toBe(303);
  });

  it('carries the filters forward, so paging never widens the set', async () => {
    const response = await POST(
      submit({ section: 'bookings', size: '25', q: 'a&b', status: 'confirmed' }),
    );

    const location = response.headers.get('location') ?? '';

    /* Re-encoded, so a `&` in a search term cannot become a second parameter. */
    expect(location).toContain('q=a%26b');
    expect(location).toContain('status=confirmed');
  });

  it('answers a body-less request with a redirect, not a parse error', async () => {
    const response = await POST(
      new Request('http://console.test/api/table-page-size', { method: 'POST' }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('content-type')).toBeNull();
  });
});
