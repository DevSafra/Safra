/**
 * The most rooms one booking may hold, across every room type in the basket.
 *
 * ## Why this is not in `booking-selection.tsx`
 *
 * It was, and the property PAGE — a server component — read it to work out how many capacity
 * sentences to resolve. `booking-selection.tsx` carries `'use client'`, and a value imported from
 * a client module into a server component is not the plain number it looks like: the multiplication
 * produced `NaN`, `Array.from({ length: NaN })` produced an empty array, and every capacity line in
 * the basket rendered as nothing. No error, no warning — the words simply were not there.
 *
 * So the constant lives in a module with no directive, which both sides may import as data.
 *
 * ## The value
 *
 * A booking is a family's trip. A group taking a floor is a conversation with the hotel, and an
 * uncapped basket is an invitation to price a stay with a number chosen to overflow something.
 * `MAX_ROOMS_PER_BOOKING` in the API is the one that ENFORCES; this is what stops the control
 * offering what the server would refuse.
 */
export const MAX_BASKET_ROOMS = 10;
