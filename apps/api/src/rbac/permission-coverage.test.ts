import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PERMISSIONS } from '@safra/contracts';

/**
 * Every permission the platform declares must actually be CHECKED somewhere.
 *
 * ## Why this test exists
 *
 * «Built, green, and connected to nothing is a state this codebase produces routinely. A capability
 * with no feature behind it is worse than a missing one, because its presence reads as coverage.»
 * Nothing enforced that for permissions, and on 2026-09-04 an audit found two that guarded nothing:
 *
 *  - `payout_account.read` — declared, granted to finance, and read by no route at all, because the
 *    write half of the payout-account feature had never been built. It guards one now.
 *  - `booking.create` — granted to every customer and unusable by construction: §4 lets a GUEST
 *    book with no account, so `POST /bookings` is `@Public()` and a permission on it would refuse
 *    most of the people it was written for. It was removed rather than wired.
 *
 * Both were invisible to every other test in the suite, because a permission that is never checked
 * fails nothing. A role editor listing it, an operator ticking it, and an auditor reading the role
 * would all have been told a capability existed.
 *
 * ## Two ways to be checked, and both count
 *
 * A permission gates a ROUTE through `@RequirePermissions`, or it gates a FIELD or a control inside
 * a response — `PAYMENT_READ` decides whether a booking's payment section is present at all, which
 * is a decision `BookingDetailService` makes rather than a guard. Counting only route decorators
 * would call the second one dead and delete a working control, which is the mistake «Before
 * deleting, ask what it DID» records.
 *
 * ## It reads the SOURCE, deliberately
 *
 * Nest's route metadata is only assembled once the whole application boots, which drags in a
 * database, Redis and a mail transport for a question that is answerable from the files. The cost
 * of reading the source is that a permission referenced only in a comment would count — so the
 * scan ignores comments, and the constant's own declaration file is excluded from the search.
 */
describe('permission coverage', () => {
  const SOURCE = new URL('../', import.meta.url).pathname;

  /** Every `.ts` under `apps/api/src`, minus the tests, with comments stripped. */
  function sources(): string[] {
    const out: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);

        if (statSync(path).isDirectory()) {
          walk(path);
        } else if (entry.endsWith('.ts') && !entry.includes('.test.')) {
          out.push(
            readFileSync(path, 'utf8')
              /*
                Comments removed BEFORE the search. This whole file is a counterexample: it names
                `payout_account.read` and `booking.create` in prose, and without this it would
                report both as covered — a test that passes because of its own documentation.
              */
              .replace(/\/\*[\s\S]*?\*\//g, '')
              .replace(/\/\/[^\n]*/g, ''),
          );
        }
      }
    };

    walk(SOURCE);

    return out;
  }

  it('every declared permission is checked somewhere in the API', () => {
    const code = sources().join('\n');
    const uncovered = Object.entries(PERMISSIONS)
      .filter(
        ([name, value]) => !code.includes(`P.${name}`) && !code.includes(`'${value}'`),
      )
      .map(([name]) => name);

    expect(uncovered).toEqual([]);
  });

  /**
   * The control that proves the scan can find nothing.
   *
   * Without it, a walk that silently read zero files would report full coverage — the exact shape
   * of «a `sed` that matched nothing reports success and changes not one byte».
   */
  it('the scan actually reads the API source', () => {
    const code = sources().join('\n');

    expect(sources().length).toBeGreaterThan(100);
    expect(code).toContain('@RequirePermissions');
    /* A name that is not a permission must NOT be found, or `includes` is matching everything. */
    expect(code).not.toContain('P.THIS_IS_NOT_A_PERMISSION');
  });
});
