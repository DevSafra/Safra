import { z } from 'zod';

import { ERROR } from './error-codes.js';
import { cursorQuerySchema } from './pagination.js';

/**
 * بطاقات الهدايا — buying a card, and turning a code into wallet balance.
 *
 * Bashar, 2026-08-11: "the customer should be able to buy a card or input a card code to receive money
 * in his wallet". Two flows, and the second is the one with teeth: a gift-card code is a BEARER
 * instrument. Whoever holds the string can convert it to money, exactly like cash, which shapes almost
 * every decision here.
 */

/**
 * The alphabet a code is drawn from — Crockford base32.
 *
 * `I`, `L`, `O` and `U` are absent on purpose. The first three are unreadable next to `1` and `0` in
 * most fonts, and a code is READ OFF a screen, an email or a printed card and typed by hand; `U` is
 * dropped so a random draw cannot spell something unfortunate. 32 symbols is 5 bits each.
 */
export const GIFT_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Four groups of five, hyphenated: `A1B2C-3D4E5-F6G7H-8J9KM`. */
export const GIFT_CODE_GROUPS = 4;
export const GIFT_CODE_GROUP_SIZE = 5;

/**
 * 20 symbols × 5 bits = 100 bits of entropy.
 *
 * That is the primary defence, and it has to be, because a rate limit only slows an attacker down.
 * At 100 bits, guessing a live code is not a threat model. Shortening this to something "friendlier"
 * would trade the only real protection for typing convenience.
 */
export const GIFT_CODE_ENTROPY_BITS = GIFT_CODE_GROUPS * GIFT_CODE_GROUP_SIZE * 5;

/**
 * Puts a typed code into the one form that is hashed.
 *
 * Called at BOTH ends — when a code is created and when one is redeemed — because a hash only matches
 * if both sides normalise identically. That is the entire reason this is in `@safra/contracts` rather
 * than in the service: a second, subtly different copy on the client would produce codes that are
 * correct and refuse to work.
 *
 * What it does, and why each part:
 * - **uppercases**, since the alphabet is uppercase and people type in lower case;
 * - **drops every hyphen, space and non-alphanumeric**, so `a1b2c 3d4e5` and `A1B2C-3D4E5` are one
 *   code — the grouping is a reading aid, not data;
 * - **maps the confusable letters onto their digits** (`I`/`L` → `1`, `O` → `0`), because a person
 *   reading `0` off a card will sometimes type `O`. The alphabet excludes those letters, so the
 *   mapping can never collide with a legitimate symbol.
 */
export function normaliseGiftCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

/** The length a normalised code must have. */
export const GIFT_CODE_LENGTH = GIFT_CODE_GROUPS * GIFT_CODE_GROUP_SIZE;

/**
 * Redeeming: one field, and it is validated on SHAPE only.
 *
 * The upper bound on the raw string is what stops a megabyte of text becoming a hash computation. The
 * normalised length is checked too, so a code that cannot possibly exist is refused at the boundary
 * rather than turning into a database lookup — which also keeps the timing of a malformed attempt
 * distinct from a real one, rather than the other way round.
 */
export const giftCardRedeemSchema = z
  .object({
    code: z
      .string()
      .min(1, ERROR.VALIDATION_REQUIRED)
      .max(64, ERROR.VALIDATION_TOO_LONG)
      .refine(
        (value) => normaliseGiftCode(value).length === GIFT_CODE_LENGTH,
        ERROR.GIFT_CARD_CODE_INVALID,
      ),
  })
  .strict();

export type GiftCardRedeemInput = z.infer<typeof giftCardRedeemSchema>;

/**
 * The amounts a card may be bought for.
 *
 * A fixed ladder rather than a free-text amount. Three reasons, in order of weight: an arbitrary
 * amount is an arbitrary liability on the balance sheet; a free field invites `0.01` and `999999`,
 * each of which needs its own rule; and a ladder is what the buyer actually wants to choose from.
 */
export const GIFT_CARD_AMOUNTS = ['25.00', '50.00', '100.00', '200.00'] as const;

export type GiftCardAmount = (typeof GIFT_CARD_AMOUNTS)[number];

/**
 * Buying a card.
 *
 * The recipient's name and email are OPTIONAL and are only ever a label: nothing is emailed by this
 * endpoint and the code is not delivered to that address. Writing them here would otherwise imply a
 * delivery that does not happen — see `docs/FUTURE-WORK.md`.
 *
 * There is no `currency` field. The card is issued in the currency of the wallet that paid for it,
 * because the purchase is a wallet DEBIT: letting the buyer name a different currency would mean
 * converting at purchase and again at redemption, and charging somebody twice for a spread on their
 * own money is not something to build by accident.
 */
export const giftCardPurchaseSchema = z
  .object({
    amount: z.enum(GIFT_CARD_AMOUNTS, { message: ERROR.GIFT_CARD_AMOUNT_INVALID }),
    recipientName: z.string().trim().min(1).max(120).optional(),
    recipientEmail: z
      .string()
      .trim()
      .email(ERROR.VALIDATION_EMAIL_INVALID)
      .max(254)
      .optional(),
  })
  .strict();

export type GiftCardPurchaseInput = z.infer<typeof giftCardPurchaseSchema>;

/** The list query for the cards a customer bought. */
export const giftCardQuerySchema = cursorQuerySchema;

export type GiftCardQuery = z.infer<typeof giftCardQuerySchema>;

/**
 * A card as its PURCHASER sees it. The code is not here.
 *
 * `gift_cards` stores `code_hash` and `code_last4`, and no endpoint returns a usable code — the
 * console's own note says a screen that displays redeemable codes turns a support tool into a way to
 * spend other people's money. The same reasoning applies to the customer's own list: the code is
 * shown ONCE, in the response to the purchase that created it, and is unrecoverable afterwards.
 */
export interface GiftCardSummary {
  readonly reference: string;
  /** The last four symbols, so a buyer can tell two cards apart without the code being present. */
  readonly codeLast4: string;
  readonly originalAmount: string;
  readonly remainingAmount: string;
  readonly currencyCode: string;
  readonly status: string;
  readonly expiresAt: string | null;
  readonly recipientName: string | null;
  readonly recipientEmail: string | null;
  readonly createdAt: string;
}

/**
 * The purchase response — the ONE time a plaintext code exists outside the buyer's screen.
 *
 * It is not stored in recoverable form, not logged, and not returned by any later read. If the buyer
 * loses it before passing it on, the card has to be cancelled and reissued by staff; that is the cost
 * of the card being a bearer instrument, and it is the same trade every gift card makes.
 */
/**
 * What an ISSUE returns — a card and its code, and no wallet.
 *
 * Not `GiftCardPurchaseResult` with two fields ignored: nobody paid for this card, so there is no
 * balance to report and inventing `walletBalance: '0.00'` would state something false about a
 * customer who may not even have a wallet.
 */
export interface GiftCardIssueResult {
  readonly card: GiftCardSummary;
  /** Grouped for reading: `A1B2C-3D4E5-F6G7H-8J9KM`. Shown ONCE and never recoverable. */
  readonly code: string;
}

export interface GiftCardPurchaseResult {
  readonly card: GiftCardSummary;
  /** Grouped for reading: `A1B2C-3D4E5-F6G7H-8J9KM`. Shown once. */
  readonly code: string;
  /** What the buyer's wallet holds now, after paying for the card. */
  readonly walletBalance: string;
  readonly walletCurrency: string;
}

/** The redemption response. */
export interface GiftCardRedeemResult {
  readonly reference: string;
  /** What the card was worth, in the CARD's currency. */
  readonly creditedAmount: string;
  readonly creditedCurrency: string;
  /** The wallet after the credit — converted, when the wallet is held in another currency. */
  readonly walletBalance: string;
  readonly walletCurrency: string;
}

/**
 * The currencies a gift card may be issued in (Bashar, 2026-08-26).
 *
 * SYP because it is what SAFRA settles in, USD because it is what the platform prices and reports
 * in, EUR because a share of customers hold one. `currencies` also carries JOD and LBP and they are
 * deliberately NOT here — a card is a bearer instrument SAFRA must honour for as long as it lives,
 * and every currency it can be denominated in is another exposure to carry.
 *
 * Enforced in the SCHEMA, not only in the picker. A dropdown is a courtesy; the endpoint is the
 * control, and the standing rule is to assume the attribute is gone and ask what the server does.
 */
export const GIFT_CARD_CURRENCIES = ['SYP', 'USD', 'EUR'] as const;

export type GiftCardCurrency = (typeof GIFT_CARD_CURRENCIES)[number];

/**
 * The most a single staff-issued card may carry, per currency.
 *
 * A TYPO GUARD, not a price list: a finance officer meaning 100 and typing 1000 creates a real
 * liability a customer may spend before anybody reads the audit row.
 *
 * ## Why it cannot be one number
 *
 * It was `1000` flat, and that was written when USD was the only currency in play. SYP and USD
 * differ by four orders of magnitude — the same fact that makes «المبلغ 200.00» unreadable without
 * its currency — so a flat 1000 would have capped a SYP card at about eight US cents and made the
 * currency unusable the moment it was offered.
 *
 * The SYP figure is the USD one at the configured rate, rounded to a round number, so the three
 * caps mean roughly the same thing. **They are engineering guard rails derived from one another,
 * not limits the business has set** — worth confirming rather than inheriting.
 */
export const MAX_ISSUED_GIFT_CARD_AMOUNT: Record<GiftCardCurrency, number> = {
  USD: 1000,
  EUR: 1000,
  SYP: 15_000_000,
};

/**
 * A card issued by SAFRA rather than bought — §9.3's «+ إنشاء بطاقة هدية».
 *
 * ## A free amount, unlike a purchase
 *
 * A customer buys one of four denominations; staff are compensating for something specific, and
 * rounding goodwill to the nearest 25 is not a kindness. The scale allowed here is the money
 * boundary's three decimals, and whether THIS amount may carry three depends on its currency —
 * which a field schema cannot see, so `GiftCardService` refuses an amount finer than its currency
 * rather than quantising it silently. Same rule as a wallet adjustment.
 *
 * ## The expiry is optional because the column is
 *
 * `gift_cards.expires_at` is nullable and a card without one does not expire. That is a product
 * decision the schema already carries, and inventing a default horizon here would quietly make it
 * for the business. The console asks for a date; the contract does not force one.
 */
export const giftCardIssueSchema = z
  .object({
    amount: z
      .string()
      .regex(/^\d{1,10}(\.\d{1,3})?$/, ERROR.VALIDATION_DECIMAL_STRING)
      .refine((v) => Number(v) > 0, ERROR.VALIDATION_AMOUNT_POSITIVE),
    currency: z.enum(GIFT_CARD_CURRENCIES, {
      message: ERROR.VALIDATION_CURRENCY_CODE,
    }),
    /** ISO date. Absent means the card does not expire — see the note above. */
    expiresOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, ERROR.VALIDATION_DATE_FORMAT)
      .optional(),
    recipientName: z.string().trim().min(1).max(120).optional(),
    /**
     * REQUIRED (Bashar, 2026-08-26) — it is how the card reaches anybody.
     *
     * It was optional, on the reasoning that a code shown once on screen could be read out or
     * handed over. That leaves the customer with nothing they can keep: only `code_hash` is stored,
     * so a card whose code exists solely in a browser session that has since been closed is a
     * liability SAFRA owes to somebody who cannot claim it.
     *
     * The screen still shows the code once, and that is now a fallback for the staff member rather
     * than the delivery mechanism.
     */
    recipientEmail: z.string().trim().email(ERROR.VALIDATION_EMAIL_INVALID).max(254),
    /** Why it was issued. Goes on the audit row, never into the customer's email. */
    reason: z.string().trim().min(3).max(500),
  })
  .strict()
  /*
    The ceiling depends on the currency, so it is checked here rather than on the field — a field
    schema cannot see its neighbours. `path` points at the amount so the console highlights the box
    somebody typed in rather than the one they chose from.
  */
  .refine(
    (value) => Number(value.amount) <= MAX_ISSUED_GIFT_CARD_AMOUNT[value.currency],
    { message: ERROR.GIFT_CARD_AMOUNT_INVALID, path: ['amount'] },
  );

export type GiftCardIssueInput = z.infer<typeof giftCardIssueSchema>;

/**
 * Voiding a live card — the fourth status, which nothing could write.
 *
 * `gift_card_status` has four values and `cancelled` was only ever READ, in the guard that refuses
 * to redeem one. So there was no way to void a card: not when a recipient reports the email was
 * intercepted, not when one is issued for the wrong amount, not when a campaign is pulled. That
 * mattered more once staff could create them — only `code_hash` is stored, so a card cannot be
 * recalled by finding its code, and the only remedy was to wait for it to be spent or to expire.
 */
export const giftCardCancelSchema = z
  .object({
    /** Why it was voided. Goes on the audit row and on the ledger description. */
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export type GiftCardCancelInput = z.infer<typeof giftCardCancelSchema>;
