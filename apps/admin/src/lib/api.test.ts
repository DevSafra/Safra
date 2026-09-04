import { describe, expect, it } from 'vitest';

import { pendingPropertyContract } from './api.js';

/**
 * Response schemas, asserted against captured responses.
 *
 * ## Why this test exists
 *
 * `staffFetch` parses every response and returns the string `'failed'` when the parse does
 * not succeed. That guard is right — a page should not render a half-understood payload —
 * but it is silent: a schema demanding one field the API never sends turns every response
 * into a generic "could not load this list", with nothing in any log to say why.
 *
 * That is exactly what happened. `pendingPropertySchema` required `status`, and
 * `GET /admin/properties/pending` does not select it (the endpoint filters on
 * `pending_review`, so the column would be the same value on every row). The listing queue
 * was permanently broken and looked like a transient API failure.
 *
 * ## The fixtures are captured, not written
 *
 * Each fixture below is a verbatim response from the running API. Hand-writing one would
 * reproduce the original mistake: the schema and the fixture would agree with each other
 * and disagree with the server. A captured response is the only thing that makes this test
 * worth having.
 */
describe('the pending-properties response schema', () => {
  /**
   * `GET /api/v1/admin/properties/pending`, captured 2026-08-04.
   *
   * Notably absent: `status`. Present and nullable: `reviewNotes`, `nameEn`. The nested
   * `partner` and `city` come from Drizzle relations, not columns.
   */
  const captured = {
    reference: 'PRO-000102',
    slug: 'payments-test-property',
    nameAr: 'دفع',
    nameEn: 'Payments Test',
    address: 'Addr',
    /* Sent by the endpoint since 2026-09-04; null on a listing that predates the field. */
    starRating: 4,
    latitude: null,
    longitude: null,
    descriptionAr: null,
    createdAt: '2026-07-31T22:04:15.619Z',
    reviewNotes: 'Photos to follow.',
    partner: {
      reference: 'PAR-000002',
      displayName: 'مزارع الشام للضيافة',
      verification: 'pending',
    },
    city: { slug: 'damascus', nameAr: 'دمشق' },
  };

  it('accepts a real response', () => {
    const parsed = pendingPropertyContract.safeParse(captured);

    // The error is asserted rather than just the boolean, so a failure names the field.
    expect(parsed.error?.issues ?? []).toStrictEqual([]);
    expect(parsed.success).toBe(true);
  });

  it('normalises the timestamp to an ISO string', () => {
    const parsed = pendingPropertyContract.parse(captured);

    expect(parsed.createdAt).toBe('2026-07-31T22:04:15.619Z');
  });

  /**
   * A `Date` reaches this schema when the driver hydrates the column rather than passing the
   * JSON through, which differs by transport. Both must land on the same string, because the
   * page slices it to get the date.
   */
  it('accepts a Date as well as a string', () => {
    const parsed = pendingPropertyContract.parse({
      ...captured,
      createdAt: new Date('2026-07-31T22:04:15.619Z'),
    });

    expect(parsed.createdAt).toBe('2026-07-31T22:04:15.619Z');
  });

  /** A missing nullable field is still a failure — null and absent are different. */
  it('rejects a response missing a field the page renders', () => {
    const { reviewNotes: _omitted, ...withoutNotes } = captured;

    expect(pendingPropertyContract.safeParse(withoutNotes).success).toBe(false);
  });

  /**
   * The regression itself, stated as a test.
   *
   * `status` must NOT be required. If someone adds it back, this fails immediately rather
   * than after a staff member reports that the queue has been empty for a week.
   */
  it('does not require a status the endpoint never sends', () => {
    expect('status' in captured).toBe(false);
    expect(pendingPropertyContract.safeParse(captured).success).toBe(true);
  });
});
