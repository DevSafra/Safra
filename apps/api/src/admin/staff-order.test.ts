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

  /**
   * `activity` and `activity/:id` are literal segments on the SAME controller as `:userId`, so
   * this one is about declaration order within the class rather than module registration.
   *
   * `Reflect.getMetadata('path', …)` on each handler is what Nest itself reads, and the order the
   * class declares them in is the order Express receives them. Declared after `:userId`,
   * `/admin/staff/activity` would arrive at the detail handler and `ParseUUIDPipe` would answer
   * 400 for a route that exists — a failure that looks like bad input rather than bad routing.
   */
  it('declares the staff activity routes before :userId', () => {
    const names = Object.getOwnPropertyNames(StaffController.prototype);

    expect(names.indexOf('activity')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('detail')).toBeGreaterThanOrEqual(0);
    expect(
      names.indexOf('activity'),
      'GET activity must be declared before GET :userId',
    ).toBeLessThan(names.indexOf('detail'));
    expect(names.indexOf('activityEntry')).toBeLessThan(names.indexOf('detail'));
  });

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
