/**
 * Whether a string can name a booking.
 *
 * ## Why a shape check exists on a page that looks nothing up
 *
 * `/booking/[reference]` is the post-payment holding page. It deliberately performs NO booking lookup —
 * a reference alone must not reveal anyone's booking, and references are sequential — but it does ECHO
 * the reference onto the page so the customer can quote it.
 *
 * That echo was unvalidated, so any URL segment rendered as an official-looking «Booking reference» on a
 * genuine SAFRA page, with the real header and branding. React escapes it, so it was never script
 * injection; it was CONTENT injection, and `/en/booking/ACCOUNT-SUSPENDED-CALL-+1-555-0100` is a
 * convincing phishing page hosted on our own domain. Found by an audit of the customer dashboard
 * (2026-08-11).
 *
 * ## The pattern
 *
 * `BKG-2026-000123` is what `booking_reference_seq` produces. `BKG-TEST-180ebd2c` is what every fixture
 * and integration row carries, which is why the middle group accepts letters and the last one accepts
 * six to eight characters — a pattern tight enough to describe only production references would refuse
 * the ones the tests are written against, and a test that cannot reach the page proves nothing about it.
 *
 * Deliberately tighter than the bounded-but-permissive check the invoices service uses: that one guards
 * a database lookup, where the query is parameterised and the only real job is bounding the input. This
 * one guards what a person READS, so it has to reject prose.
 */
const BOOKING_REFERENCE = /^BKG-[A-Z0-9]{4}-[A-Za-z0-9]{6,8}$/;

export function isBookingReference(value: string): boolean {
  return BOOKING_REFERENCE.test(value);
}
