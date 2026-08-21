import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { SettingsService } from '../settings/settings.service.js';
import { ReviewService } from './review.service.js';
import { codeOf } from '../common/errors/app-error.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Staff scope reaches the two P-002 verification screens, which it did not until 2026-08-20.
 *
 * ## What was wrong
 *
 * `scope.sql.ts` says it in its own comment: "Duplicating the predicate per service is how a scope
 * ends up enforced on eight resources and forgotten on the ninth — and the ninth is the one somebody
 * finds." `review.service.ts` was the ninth. It serves the partner and listing verification queues,
 * both detail screens and both decision endpoints, and none of its methods took an actor at all —
 * `pendingPartners.length > 1` was false, so there was nothing to scope BY.
 *
 * A city-scoped operations manager could therefore:
 *
 *   - see every partner in the country awaiting verification,
 *   - open any partner or listing by reference,
 *   - and APPROVE OR REJECT either of them, anywhere.
 *
 * The last one is the serious half: `assertCanWrite` existed and was called in exactly two other
 * services. §8.2's rule is that a write outside scope is refused in BOTH modes, `read_only` included.
 *
 * ## Why it had never been reachable
 *
 * Every staff row in the database is `all_cities`. The gap needed somebody to use the console's own
 * scope map first — so the feature that would have exposed it is the feature that describes it.
 *
 * ## Scopes are built as CLAIMS, not as users
 *
 * `scopeOf` reads `actor.scope` straight off the access token, so a claims object is the whole input
 * and no fixture user is needed. That also keeps the test honest about what it covers: the guard, not
 * the token issuer.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the verification screens honour a city scope', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let review: ReviewService;
  let cityA: string;
  let cityB: string;
  let partnerInA: string;
  let propertyInA: string;

  /** Restricted to `cities`, with no access at all outside them. */
  const scopedTo = (...cityIds: string[]): AccessTokenClaims =>
    ({
      sub: '00000000-0000-0000-0000-000000000009',
      role: 'operations_manager',
      scope: { kind: 'cities', cityIds, outside: 'none' },
    }) as unknown as AccessTokenClaims;

  /** Restricted, but permitted to READ the rest of the country. */
  const readOnlyOutside = (...cityIds: string[]): AccessTokenClaims =>
    ({
      sub: '00000000-0000-0000-0000-000000000009',
      role: 'operations_manager',
      scope: { kind: 'cities', cityIds, outside: 'read_only' },
    }) as unknown as AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    review = new ReviewService(db, {} as never, {} as never, new SettingsService(db));

    const cities = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM cities WHERE deleted_at IS NULL ORDER BY slug LIMIT 2
    `);

    cityA = cities.rows[0]!.id;
    cityB = cities.rows[1]!.id;

    /* A partner and a listing awaiting verification, both in city A. */
    const made = await db.execute<{ partner: string; property: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM partner_types LIMIT 1)          AS partner_type_id,
               (SELECT id FROM property_types LIMIT 1)         AS type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)  AS policy_id
      ), u AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('scope-' || gen_random_uuid() || '@safra.test', '+963900000200', 'partner',
                'active')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT u.id, ref.partner_type_id, 'Scope Test', 'نطاق', ${cityA}::uuid, 'x',
               '+963900000200', 'scope-p-' || gen_random_uuid() || '@safra.test', 'pending'
        FROM u, ref RETURNING id, reference
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ${cityA}::uuid, ref.type_id, ref.policy_id,
               'scope-' || gen_random_uuid(), 'نطاق', 'Scope', 'Scope', 'x', 'pending_review'
        FROM pa, ref RETURNING reference
      )
      SELECT (SELECT reference FROM pa) AS partner, (SELECT reference FROM pr) AS property
    `);

    partnerInA = made.rows[0]!.partner;
    propertyInA = made.rows[0]!.property;
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  // ─── The queues ────────────────────────────────────────────────────────────

  it('shows a scoped member only their own cities', async () => {
    const inScope = await review.pendingPartners(
      { page: 1, limit: 100 },
      scopedTo(cityA),
    );
    const outOfScope = await review.pendingPartners(
      { page: 1, limit: 100 },
      scopedTo(cityB),
    );

    expect(inScope.items.some((p) => p.reference === partnerInA)).toBe(true);
    expect(
      outOfScope.items.some((p) => p.reference === partnerInA),
      'a partner in city A must not appear to a member scoped to city B',
    ).toBe(false);
  });

  /**
   * The count must describe the same set as the list.
   *
   * They are built in two different dialects — the list through the relational builder, the count
   * through a `LIMIT` subquery — so this is the assertion that stops them drifting. «٥٢٧ نتيجة» over
   * a list of nothing is the failure the pagination rule names.
   */
  it('counts what it lists, for a scoped member', async () => {
    const page = await review.pendingPartners({ page: 1, limit: 100 }, scopedTo(cityB));

    const actual = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM partners
       WHERE verification = 'pending' AND deleted_at IS NULL AND city_id = ${cityB}::uuid
    `);

    expect(page.total).toBe(Number(actual.rows[0]!.n));
  });

  /**
   * Asserted on the TOTAL, not by hunting for the seeded row.
   *
   * The queue is oldest-first over hundreds of rows, so a partner created a moment ago is on the
   * last page by construction — a test that looked for it on page one would fail for a reason with
   * nothing to do with scope. The total is the honest measure of "how much can this member see".
   */
  it('leaves an unscoped member seeing everything', async () => {
    const unscoped = await review.pendingPartners({ page: 1, limit: 1 }, undefined);
    const scoped = await review.pendingPartners({ page: 1, limit: 1 }, scopedTo(cityB));

    expect(unscoped.total).toBeGreaterThan(scoped.total);
  });

  /** `read_only` widens READS to the whole country — that is the whole point of the mode. */
  it('shows the whole country to a read_only member', async () => {
    const unscoped = await review.pendingPartners({ page: 1, limit: 1 }, undefined);
    const readOnly = await review.pendingPartners(
      { page: 1, limit: 1 },
      readOnlyOutside(cityB),
    );
    const strict = await review.pendingPartners({ page: 1, limit: 1 }, scopedTo(cityB));

    expect(readOnly.total, 'read_only sees what an unscoped member sees').toBe(
      unscoped.total,
    );
    expect(
      readOnly.total,
      'and strictly more than `none` on the same cities',
    ).toBeGreaterThan(strict.total);
  });

  // ─── The detail screens ────────────────────────────────────────────────────

  it('refuses a partner outside scope as NOT FOUND, not forbidden', async () => {
    const refusal = await review
      .partnerDetail(partnerInA, scopedTo(cityB))
      .catch((error: unknown) => error);

    expect(
      codeOf(refusal),
      '"not yours" must read the same as "not there" — a 403 confirms it exists',
    ).toBe(ERROR.REQUEST_NOT_FOUND);
  });

  it('refuses a listing outside scope the same way', async () => {
    const refusal = await review
      .propertyDetail(propertyInA, scopedTo(cityB))
      .catch((error: unknown) => error);

    expect(codeOf(refusal)).toBe(ERROR.REQUEST_NOT_FOUND);
  });

  it('opens a partner inside scope', async () => {
    await expect(
      review.partnerDetail(partnerInA, scopedTo(cityA)),
    ).resolves.toMatchObject({
      reference: partnerInA,
    });
  });

  /** And the internal uuid selected for the check does not travel in the response. */
  it('does not return the city uuid it checked against', async () => {
    const detail = await review.partnerDetail(partnerInA, scopedTo(cityA));

    expect(detail).not.toHaveProperty('cityId');
  });

  // ─── The decisions, which is the half that matters ─────────────────────────

  it('refuses to verify a partner outside scope', async () => {
    const refusal = await review
      .verifyPartner(scopedTo(cityB), partnerInA, { decision: 'approve' })
      .catch((error: unknown) => error);

    expect(codeOf(refusal)).toBe(ERROR.REQUEST_NOT_FOUND);
  });

  it('refuses to review a listing outside scope', async () => {
    const refusal = await review
      .reviewProperty(scopedTo(cityB), propertyInA, { decision: 'approve' })
      .catch((error: unknown) => error);

    expect(codeOf(refusal)).toBe(ERROR.REQUEST_NOT_FOUND);
  });

  /**
   * `read_only` must NOT permit a write, and the refusal is a 403 rather than a 404.
   *
   * The member can already see the row, so hiding it now would be absurd — they are told the action
   * is not theirs. This is the case that makes reusing the read guard for writes wrong.
   */
  it('refuses a write from a read_only member, as forbidden', async () => {
    const refusal = await review
      .verifyPartner(readOnlyOutside(cityB), partnerInA, { decision: 'approve' })
      .catch((error: unknown) => error);

    expect(codeOf(refusal)).toBe(ERROR.SCOPE_OUTSIDE);
  });
});
