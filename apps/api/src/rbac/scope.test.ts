import { describe, expect, it } from 'vitest';

import {
  SCOPED_RESOURCES,
  UNSCOPED,
  UNSCOPED_RESOURCES,
  canReadInCity,
  canWriteInCity,
  isRestricted,
  isScopable,
  setStaffScopeSchema,
  type StaffScope,
} from '@safra/contracts';

import { assertCanWrite, readsAreScoped, scopeFilter, scopeOf } from './scope.sql.js';

/**
 * Staff scope enforcement (design handoff §8.2, Bashar's decision 2026-08-04).
 *
 * ## The decision, restated as a table
 *
 * | Mode | Read inside | Read outside | Write inside | Write outside |
 * | --- | --- | --- | --- | --- |
 * | `all_cities` | ✅ | ✅ | ✅ | ✅ |
 * | `cities` + `none` | ✅ | ❌ 404 | ✅ | ❌ 404 |
 * | `cities` + `read_only` | ✅ | ✅ | ✅ | ❌ 403 |
 *
 * Every cell below is tested. The one people get wrong is the bottom-right: `read_only` widens READ
 * only, and there is no configuration in which a Latakia-scoped agent writes to a Damascus record.
 */
const LATAKIA = '11111111-1111-1111-1111-111111111111';
const TARTUS = '22222222-2222-2222-2222-222222222222';
const DAMASCUS = '33333333-3333-3333-3333-333333333333';

const coastal = (outside: 'none' | 'read_only'): StaffScope => ({
  kind: 'cities',
  cityIds: [LATAKIA, TARTUS],
  outside,
});

describe('the scope model', () => {
  describe('all_cities restricts nothing', () => {
    it('reads and writes anywhere', () => {
      for (const city of [LATAKIA, DAMASCUS, null]) {
        expect(canReadInCity(UNSCOPED, city)).toBe(true);
        expect(canWriteInCity(UNSCOPED, city)).toBe(true);
      }

      expect(isRestricted(UNSCOPED)).toBe(false);
    });

    it('produces a filter Postgres folds away', () => {
      expect(scopeFilter(undefined, 'b.city_id').queryChunks).toHaveLength(1);
    });
  });

  /**
   * A `cities` scope with an EMPTY list is unrestricted.
   *
   * This case matters more than it looks: a member switched to `cities` before any city is assigned
   * would otherwise see nothing at all, which reads as a broken console rather than as a
   * configuration somebody is halfway through making.
   */
  it('treats an empty city list as unrestricted', () => {
    const half: StaffScope = { kind: 'cities', cityIds: [], outside: 'none' };

    expect(isRestricted(half)).toBe(false);
    expect(canReadInCity(half, DAMASCUS)).toBe(true);
    expect(canWriteInCity(half, DAMASCUS)).toBe(true);
  });

  describe('mode: no access outside scope', () => {
    const scope = coastal('none');

    it('reads inside scope', () => {
      expect(canReadInCity(scope, LATAKIA)).toBe(true);
      expect(canReadInCity(scope, TARTUS)).toBe(true);
    });

    it('does NOT read outside scope', () => {
      expect(canReadInCity(scope, DAMASCUS)).toBe(false);
    });

    it('writes inside scope', () => {
      expect(canWriteInCity(scope, LATAKIA)).toBe(true);
    });

    it('does NOT write outside scope', () => {
      expect(canWriteInCity(scope, DAMASCUS)).toBe(false);
    });

    /**
     * A row outside scope is reported ABSENT, not forbidden.
     *
     * A 403 would confirm the row exists, which is itself information this member is not scoped to
     * have. So the refusal is a 404 — the only answer that leaks nothing.
     */
    it('refuses an outside write as 404, never 403', () => {
      expect(() => assertCanWrite(claims(scope), DAMASCUS)).toThrowError(/not found/i);

      try {
        assertCanWrite(claims(scope), DAMASCUS);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect((error as { status?: number }).status).toBe(404);
      }
    });

    it('filters reads in SQL', () => {
      const filter = scopeFilter(claims(scope), 'b.city_id');

      // More than one chunk means a real predicate was built, not the `TRUE` short-circuit.
      expect(filter.queryChunks.length).toBeGreaterThan(1);
      expect(readsAreScoped(claims(scope))).toBe(true);
    });
  });

  describe('mode: read-only outside scope', () => {
    const scope = coastal('read_only');

    it('reads everywhere', () => {
      expect(canReadInCity(scope, LATAKIA)).toBe(true);
      expect(canReadInCity(scope, DAMASCUS)).toBe(true);
    });

    it('writes ONLY inside scope', () => {
      expect(canWriteInCity(scope, TARTUS)).toBe(true);
      expect(canWriteInCity(scope, DAMASCUS)).toBe(false);
    });

    /**
     * Here the refusal IS a 403.
     *
     * The member can already see the row, so pretending it is absent would be absurd — and would
     * make the console look broken rather than restricted.
     */
    it('refuses an outside write as 403', () => {
      try {
        assertCanWrite(claims(scope), DAMASCUS);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect((error as { status?: number }).status).toBe(403);
      }
    });

    /** Reads are unfiltered in this mode, so the SQL short-circuits and the flag says so. */
    it('does not filter reads', () => {
      expect(scopeFilter(claims(scope), 'b.city_id').queryChunks).toHaveLength(1);
      expect(readsAreScoped(claims(scope))).toBe(false);
    });
  });

  /**
   * A row with NO city is always in scope.
   *
   * Scope narrows by geography; it cannot narrow what has no geography. A platform-level record —
   * a coupon, a currency — belongs to everyone whose permissions allow it.
   */
  it('always allows a row with no city', () => {
    for (const outside of ['none', 'read_only'] as const) {
      expect(canReadInCity(coastal(outside), null)).toBe(true);
      expect(canWriteInCity(coastal(outside), null)).toBe(true);
      expect(() => assertCanWrite(claims(coastal(outside)), null)).not.toThrow();
    }
  });

  describe('who can be scoped', () => {
    /**
     * A super admin is never scoped.
     *
     * Not a convenience: scoping the only role that can un-scope an account is a lockout whose
     * remedy requires the person locked out.
     */
    it('refuses to scope a super admin', () => {
      expect(isScopable('super_admin')).toBe(false);
    });

    it('refuses to scope a customer or a partner', () => {
      expect(isScopable('customer')).toBe(false);
      expect(isScopable('partner')).toBe(false);
    });

    it('allows the three scopable staff roles', () => {
      expect(isScopable('support_agent')).toBe(true);
      expect(isScopable('finance_officer')).toBe(true);
      expect(isScopable('operations_manager')).toBe(true);
    });
  });

  describe('the resource lists are exhaustive and disjoint', () => {
    /**
     * A resource cannot be both scoped and unscoped.
     *
     * The lists exist so that adding a city-bearing resource without scoping it is a visible
     * omission. An overlap would make them useless as documentation.
     */
    it('shares no resource between the two lists', () => {
      const scoped = new Set<string>(SCOPED_RESOURCES);

      for (const resource of UNSCOPED_RESOURCES) {
        expect(scoped.has(resource), resource).toBe(false);
      }
    });

    /**
     * The audit log is unscoped, permanently.
     *
     * Bashar, 2026-08-04: "a scoped audit log is not a trustworthy audit log". This assertion is
     * the guard against a future change scoping it for consistency with everything else.
     */
    it('keeps the audit log unscoped', () => {
      expect(UNSCOPED_RESOURCES).toContain('audit_log');
      expect(SCOPED_RESOURCES).not.toContain('audit_log');
    });

    /** Wallet, gift cards and coupons belong to a customer or the platform, never a city. */
    it('keeps the customer-owned and platform-wide resources unscoped', () => {
      for (const resource of ['wallet', 'gift_cards', 'coupons', 'customers'] as const) {
        expect(UNSCOPED_RESOURCES).toContain(resource);
      }
    });
  });

  describe('the administration schema', () => {
    it('accepts a city scope', () => {
      const parsed = setStaffScopeSchema.safeParse({
        kind: 'cities',
        citySlugs: ['latakia', 'tartus'],
        outside: 'read_only',
      });

      expect(parsed.error?.issues ?? []).toStrictEqual([]);
    });

    /** Starting a scope with no cities yet is legitimate — see the empty-list test above. */
    it('accepts a city scope with no cities yet', () => {
      expect(
        setStaffScopeSchema.safeParse({ kind: 'cities', citySlugs: [], outside: 'none' })
          .success,
      ).toBe(true);
    });

    /**
     * `all_cities` with a city list is a contradiction and is REFUSED.
     *
     * Silently ignoring the list would leave the administrator believing a restriction is in force.
     */
    it('refuses an all-cities scope carrying a city list', () => {
      expect(
        setStaffScopeSchema.safeParse({
          kind: 'all_cities',
          citySlugs: ['latakia'],
          outside: 'none',
        }).success,
      ).toBe(false);
    });

    it('rejects an unknown mode and an unknown kind', () => {
      expect(
        setStaffScopeSchema.safeParse({ kind: 'cities', citySlugs: [], outside: 'write' })
          .success,
      ).toBe(false);
      expect(
        setStaffScopeSchema.safeParse({
          kind: 'everything',
          citySlugs: [],
          outside: 'none',
        }).success,
      ).toBe(false);
    });

    /** `.strict()` — an unknown field is rejected, never quietly dropped. */
    it('rejects an unknown field', () => {
      expect(
        setStaffScopeSchema.safeParse({
          kind: 'cities',
          citySlugs: [],
          outside: 'none',
          alsoAllowEverything: true,
        }).success,
      ).toBe(false);
    });
  });

  /** A missing or absent claim resolves to unrestricted, which is the pre-scope behaviour. */
  it('defaults an absent claim to unrestricted', () => {
    expect(scopeOf(undefined)).toStrictEqual(UNSCOPED);
    expect(scopeOf({ sub: 'x' } as never)).toStrictEqual(UNSCOPED);
  });
});

/** Minimal claims carrying a scope, which is all these functions read. */
function claims(scope: StaffScope) {
  return {
    sub: 'user',
    role: 'operations_manager',
    permissions: [],
    locale: 'ar',
    scope,
  } as never;
}
