import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import { AdminOperationsController } from './operations.controller.js';

/**
 * `GET /admin/audit-log/actions` must not be answered by `GET /admin/audit-log/:id`.
 *
 * Express matches in DECLARATION order, not by specificity, so a parameter route declared before a
 * literal sibling swallows it: `/admin/audit-log/actions` arrives as an id, `ParseUUIDPipe` answers
 * 400, and the console's action filter loses its options with an error that reads as bad input
 * rather than bad routing.
 *
 * ## Why this exists when the two routes are thirty lines apart in one file
 *
 * Because I wrote it in the wrong order. `staff-order.test.ts` holds the same invariant across two
 * controllers, and writing this route reminded me to check — the docblock I first wrote said the
 * ordering was "adjacent enough to read at a glance", underneath code that had it backwards.
 *
 * An invariant nobody can see by reading is not less real for being on one screen.
 */
describe('the admin/audit-log route prefix', () => {
  it('declares the literal segment before the parameter', () => {
    const names = Object.getOwnPropertyNames(AdminOperationsController.prototype);
    const actions = names.indexOf('auditActions');
    const entry = names.indexOf('auditEntry');

    expect(actions, 'auditActions is not on the controller').toBeGreaterThanOrEqual(0);
    expect(entry, 'auditEntry is not on the controller').toBeGreaterThanOrEqual(0);
    expect(
      actions,
      'GET audit-log/actions must be declared before GET audit-log/:id',
    ).toBeLessThan(entry);
  });
});
