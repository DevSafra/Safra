import type { z } from 'zod';

import { cursorQuerySchema } from './pagination.js';

/**
 * الفواتير — the money record behind a booking (handoff §6).
 *
 * ## This is a RECEIPT, not a tax invoice
 *
 * The distinction is not pedantry, and getting it wrong is the kind of mistake an auditor finds rather
 * than a test. A tax invoice is ISSUED: it carries a gapless sequential number from a register, the
 * seller's legal identity and tax registration, a tax breakdown at the applicable rate, and — once
 * issued — it may not change. None of that exists in this system yet, and minting a number for a
 * document that CLAIMED to be one would be worse than not having the document.
 *
 * What this is: a faithful statement of what a booking cost and what was paid, addressed to the person
 * who paid it. Every figure is READ from the booking row — the service computes nothing, not even the
 * total — so this document cannot disagree with the booking it describes.
 *
 * `docs/FUTURE-WORK.md` §4 carries what a real tax document would need.
 *
 * ## The booking reference IS the receipt reference
 *
 * One booking, one receipt, so a second identifier would be a second thing to keep in step and a
 * second thing for a customer to quote at support. `BKG-2026-000123` names both.
 */

/** A line on the receipt. The KEY is a code; the reader's language supplies the word. */
export const INVOICE_LINE_KEYS = [
  'accommodation',
  'serviceFee',
  'discount',
  'giftCard',
  'wallet',
] as const;

export type InvoiceLineKey = (typeof INVOICE_LINE_KEYS)[number];

export interface InvoiceLine {
  readonly key: InvoiceLineKey;
  /** A decimal string, exactly as the database holds it. Never a float — see `formatMoney`. */
  readonly amount: string;
  /**
   * Whether this line comes OFF the total.
   *
   * The database holds a discount as a positive number, so the sign is a property of the LINE rather
   * than of the figure. Sending the flag instead of a negated string keeps the amount identical to the
   * stored value and leaves the minus sign to the locale that renders it.
   */
  readonly deduction: boolean;
}

/**
 * A name in all three languages, for the client to pick from.
 *
 * The API must not pre-pick with `coalesce(name_ar, name_en)`: only the reader's URL knows which
 * language they chose, and a receipt is exactly the document somebody forwards to a German accountant.
 */
export interface InvoiceTranslatedName {
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly nameDe: string | null;
}

export interface InvoiceProperty extends InvoiceTranslatedName {
  readonly slug: string;
}

export interface InvoicePayment {
  readonly reference: string;
  readonly method: string;
  readonly status: string;
  readonly amount: string;
  readonly currencyCode: string;
  readonly capturedAt: string | null;
}

/** What a row in the list carries — no lines, no payments. See `InvoiceDetail`. */
export interface InvoiceSummary {
  /** The booking reference, which is also this receipt's reference. */
  readonly reference: string;
  readonly bookingStatus: string;
  /** When the booking was created — the date this record is *of*, not the date it was rendered. */
  readonly issuedAt: string;
  readonly paidAt: string | null;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly property: InvoiceProperty;
  readonly city: InvoiceTranslatedName;
  readonly currencyCode: string;
  /** `bookings.total_amount`, read verbatim. */
  readonly totalAmount: string;
}

/**
 * One receipt in full.
 *
 * The breakdown and the payment history are here and NOT on the list row, because a list of twenty
 * receipts would otherwise be twenty payment lookups to render figures nobody has asked to see yet.
 */
export interface InvoiceDetail extends InvoiceSummary {
  readonly lines: readonly InvoiceLine[];
  readonly payments: readonly InvoicePayment[];
}

/**
 * The list query.
 *
 * Cursor-based, like every customer-facing list: a receipt list only ever grows, and the newest is the
 * one somebody wants. No filter — a filtered receipt list is a feature nobody has asked for, and each
 * filter is another predicate to keep in step.
 */
export const invoiceQuerySchema = cursorQuerySchema;

export type InvoiceQuery = z.infer<typeof invoiceQuerySchema>;
