import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { PARTNER_EMPLOYEE_PERMISSIONS, type Permission } from '@safra/contracts';

import { PERMISSIONS_KEY } from '../rbac/decorators.js';
import { PartnerContractsController } from './partner-contracts.controller.js';
import { PartnerDocumentsController } from './documents.controller.js';

/**
 * What a partner's EMPLOYEE can actually reach, read off the routes rather than off the allow-list.
 *
 * ## Why the allow-list is not the answer
 *
 * `PARTNER_EMPLOYEE_PERMISSIONS` is where the boundary is DECLARED, and its docblock names what is
 * deliberately withheld: payouts, the partnership agreement, and "anything touching the partner's
 * own account, documents, or bank details".
 *
 * A permission is only a boundary where a route asks for it. `PARTNER_CONTRACT_READ` is excluded
 * from the employee list — but the PARTNER does not hold it either (it is a staff permission), so
 * the partner-side contract routes were never guarded by it. They ask for `PROPERTY_MANAGE_OWN`,
 * which an employee holds because managing listings is their job. The exclusion excluded nothing.
 *
 * The same is true of the documents routes, and there the payload is the owner's identity papers.
 *
 * ## Why this reads route metadata instead of listing the offenders
 *
 * A test naming the two controllers that were wrong would pass forever while a third made the same
 * mistake next week. `@RequirePermissions` writes its argument as metadata, so the question "can
 * an employee's permission set satisfy this route" is answerable for EVERY handler — and the
 * answer for an owner-only controller must be no, whatever permission somebody reaches for.
 *
 * This is the second time today the declared boundary and the enforced one disagreed: the first
 * was a guard skipped by a missing row. Both were invisible to a suite that tested each side
 * separately.
 */
const reflector = new Reflector();

/** Every handler on a controller, with whatever `@RequirePermissions` put on it. */
function routes(
  controller: new (...args: never[]) => object,
): { name: string; required: Permission[] }[] {
  const prototype = controller.prototype as Record<string, unknown>;

  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor' && typeof prototype[name] === 'function')
    .map((name) => ({
      name,
      required:
        reflector.get<Permission[] | undefined>(
          PERMISSIONS_KEY,
          prototype[name] as () => unknown,
        ) ?? [],
    }));
}

/**
 * Could an account holding ONLY the employee permission set call this handler?
 *
 * `PermissionsGuard` passes when the caller holds every listed permission, so a route is reachable
 * when the employee set is a superset of what it requires. A route requiring NOTHING is reachable
 * by any authenticated caller, which for an owner-only surface is worse still.
 */
function reachableByEmployee(required: Permission[]): boolean {
  const held = new Set<string>(PARTNER_EMPLOYEE_PERMISSIONS);

  return required.every((permission) => held.has(permission));
}

/**
 * Controllers whose every route belongs to the OWNER alone.
 *
 * Not "mostly the owner" — an employee reaching any handler on these is a defect. The partnership
 * agreement is between SAFRA and the person who signed it, and the verification documents are that
 * person's identity papers.
 */
const OWNER_ONLY = [
  ['partner contracts', PartnerContractsController],
  ['partner documents', PartnerDocumentsController],
] as const;

describe('what a partner employee can reach', () => {
  for (const [label, controller] of OWNER_ONLY) {
    describe(label, () => {
      const handlers = routes(controller);

      /* A controller that resolved to nothing would make every assertion below vacuous. */
      it('has handlers to check', () => {
        expect(handlers.length).toBeGreaterThan(0);
      });

      for (const { name, required } of handlers) {
        it(`refuses an employee at ${name}`, () => {
          expect({
            handler: name,
            requires: required,
            reachable: reachableByEmployee(required),
          }).toMatchObject({ reachable: false });
        });
      }
    });
  }

  /**
   * The exclusion that reads as protection and is not.
   *
   * Keeping `PARTNER_CONTRACT_READ` out of the employee list looks like the control that stops an
   * employee reading the agreement. It cannot be: the PARTNER does not hold it either, so no
   * partner-side route can be guarded by it without locking the owner out too. Stated here so the
   * next reader of that docblock does not take the same comfort from it that I did.
   */
  it('does not rely on withholding a permission the partner never had', () => {
    const held = new Set<string>(PARTNER_EMPLOYEE_PERMISSIONS);

    expect(held.has('partner_contract.read')).toBe(false);
  });
});
