import { describe, expect, it } from 'vitest';

import { PERMISSIONS as P } from '@safra/contracts';

import { PERMISSIONS_KEY } from '../rbac/decorators.js';
import { AdminOperationsController } from './operations.controller.js';
import { BookingsController } from '../bookings/bookings.controller.js';

/**
 * The three booking WRITES, and the capability each one actually requires.
 *
 * ## Read from the metadata, never grepped
 *
 * This is the method the capability sweep of 2026-08-23 used, and it is the only one that answers
 * the question. A grep for `BOOKING_CANCEL` finds the decorator's TEXT — including one that was
 * commented out, moved to the wrong handler, or written on a route nobody calls. Reflecting the
 * metadata off the handler asks the framework what it will actually enforce.
 *
 * ## Why these three
 *
 * All three had the same defect until 2026-08-25 and it was the opposite of a missing guard: the
 * guards were right and nothing in the console could reach them. Wiring a surface to a
 * staff-gated endpoint is exactly the change that makes a wrong capability matter, because until
 * now nobody could press the button to find out.
 *
 * The console gates the same controls a second time from `readerPermissions()`. That is a
 * COURTESY — it decides what is worth drawing — and this is the control: a person who deletes a
 * `disabled` attribute, replays the form, or posts by hand meets the guard asserted here.
 */
describe('the capabilities behind a booking write', () => {
  const required = (target: object, method: string): unknown =>
    Reflect.getMetadata(
      PERMISSIONS_KEY,
      (target as Record<string, { constructor: unknown }>)[method] as object,
    );

  it('gates an internal note on booking.add_internal_note alone', () => {
    expect(required(AdminOperationsController.prototype, 'addBookingNote')).toEqual([
      P.BOOKING_ADD_INTERNAL_NOTE,
    ]);
  });

  /**
   * `BOOKING_CANCEL`, not `BOOKING_UPDATE_STATUS`.
   *
   * Cancelling ends a stay somebody has paid for and starts a refund; moving a status does not.
   * §4 gives operations both and support neither, so the two are separate capabilities and a
   * single "manage bookings" grant would merge two decisions of very different weight.
   */
  it('gates a staff cancellation on booking.cancel alone', () => {
    expect(required(BookingsController.prototype, 'cancel')).toEqual([P.BOOKING_CANCEL]);
  });

  it('gates capturing a payment on booking.update_status alone', () => {
    expect(required(BookingsController.prototype, 'capturePayment')).toEqual([
      P.BOOKING_UPDATE_STATUS,
    ]);
  });

  /**
   * And reading a booking is NOT enough to write to one.
   *
   * The control on the two assertions above: if every handler carried `BOOKING_READ_ALL` they
   * would still each "have a permission", and a support agent who may read every booking could
   * cancel any of them. Naming what must NOT be there is what makes the list meaningful.
   */
  it('does not let a read capability stand in for any of the three', () => {
    for (const [target, method] of [
      [AdminOperationsController.prototype, 'addBookingNote'],
      [BookingsController.prototype, 'cancel'],
      [BookingsController.prototype, 'capturePayment'],
    ] as const) {
      expect(required(target, method)).not.toContain(P.BOOKING_READ_ALL);
    }
  });
});
