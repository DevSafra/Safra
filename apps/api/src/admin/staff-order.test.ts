import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import { AdminModule } from './admin.module.js';
import { RegistriesController } from './registries.controller.js';
import { StaffController } from './staff.controller.js';

/**
 * `GET /admin/staff/overview` must not be answered by `GET /admin/staff/:userId`.
 *
 * Three routes share the `admin/staff` prefix and they live on two controllers: `overview` and
 * `scopes` are static segments on `RegistriesController`, and `:userId` is a parameter on
 * `StaffController`. Express matches in REGISTRATION order, not by specificity, so the only thing
 * keeping `overview` from arriving as a user id is that `AdminModule` lists `RegistriesController`
 * first.
 *
 * That is an ordering dependency in an array of ten names, with nothing in either file pointing at
 * the other. Reordered, `ParseUUIDPipe` answers 400 for `overview`, `staffFetch` turns 400 into
 * `'failed'`, and `/staff` renders with its counters missing — no error anywhere, just a screen
 * quietly showing less than it should.
 */
describe('the admin/staff route prefix', () => {
  const controllers = Reflect.getMetadata('controllers', AdminModule) as unknown[];

  it('registers the static routes before the parameterised one', () => {
    const registries = controllers.indexOf(RegistriesController);
    const staff = controllers.indexOf(StaffController);

    expect(registries, 'RegistriesController is not registered').toBeGreaterThanOrEqual(
      0,
    );
    expect(staff, 'StaffController is not registered').toBeGreaterThanOrEqual(0);

    expect(
      registries,
      'RegistriesController must come first, or /admin/staff/overview is matched by /admin/staff/:userId',
    ).toBeLessThan(staff);
  });
});
