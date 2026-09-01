import { createHash, randomInt } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ERROR,
  GIFT_CODE_ALPHABET,
  GIFT_CODE_GROUPS,
  GIFT_CODE_GROUP_SIZE,
  type GiftCardPurchaseInput,
  DEFAULT_MAX_ISSUED_GIFT_CARD,
  GIFT_CARD_CURRENCIES,
  giftCardCeilingKey,
  type GiftCardCancelInput,
  type GiftCardIssueInput,
  type GiftCardIssueResult,
  type GiftCardPurchaseResult,
  type GiftCardQuery,
  type GiftCardRedeemResult,
  type GiftCardSummary,
  decodeCursor,
  encodeCursor,
  normaliseGiftCode,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { LedgerService, type LedgerLeg } from '../ledger/ledger.service.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { MONEY_SCALE, quantise, toMinor } from '../common/money.js';
import { DEFAULT_LOCALE } from '@safra/i18n';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { WalletService, withdrawableOf } from '../wallet/wallet.service.js';
import { badRequest, notFound, unauthorized } from '../common/errors/app-error.js';
import { ENV, type Env } from '../config/env.js';
import { MailService } from '../mail/mail.service.js';
import { giftCardPurchasedMail, giftCardReceivedMail } from '../mail/mail.templates.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hashes a normalised code.
 *
 * SHA-256, not Argon2, and the difference from a password is the point: a password is low-entropy and
 * chosen by a human, so it needs a slow hash to survive an offline attack on a stolen digest. A code
 * here is 100 random bits, which no amount of hashing hardware makes guessable — and it is looked up
 * on the UNIQUE index `gift_cards_code_hash_unique`, which a per-row slow hash would make impossible:
 * verifying an Argon2 digest means fetching every card and testing each one.
 *
 * The same reasoning `booking-access.service.ts` already applies to its access tokens.
 */
function hashCode(normalised: string): string {
  return createHash('sha256').update(normalised).digest('hex');
}

/** Groups a normalised code for reading: `A1B2C-3D4E5-F6G7H-8J9KM`. */
function group(normalised: string): string {
  const groups: string[] = [];

  for (let at = 0; at < normalised.length; at += GIFT_CODE_GROUP_SIZE) {
    groups.push(normalised.slice(at, at + GIFT_CODE_GROUP_SIZE));
  }

  return groups.join('-');
}

/**
 * A fresh code.
 *
 * `randomInt` from `node:crypto`, never `Math.random()`: a predictable generator would make every
 * card in a batch derivable from one of them. `randomInt` is also rejection-sampled internally, so the
 * distribution over a 32-symbol alphabet is uniform rather than biased towards the first symbols the
 * way `% length` on a random byte would be.
 */
function generateCode(): string {
  let code = '';

  for (let at = 0; at < GIFT_CODE_GROUPS * GIFT_CODE_GROUP_SIZE; at += 1) {
    code += GIFT_CODE_ALPHABET[randomInt(GIFT_CODE_ALPHABET.length)];
  }

  return code;
}

type CardRow = {
  id: string;
  reference: string;
  code_last4: string;
  original_amount: string;
  remaining_amount: string;
  currency_id: string;
  currency_code: string;
  status: string;
  expires_at: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  created_at: string;
  purchased_by_customer_id: string | null;
};

/**
 * بطاقات الهدايا (handoff §6).
 *
 * ## A code is cash
 *
 * Whoever holds the string can turn it into money. Everything below follows from that:
 *
 * - **The plaintext is never stored.** Only `code_hash` and `code_last4`. A database dump, a backup or
 *   a support screen therefore cannot spend anybody's card, and the console's existing note — "a
 *   screen that displays redeemable codes turns a support console into a way to spend other people's
 *   money" — holds for the customer's own list too.
 * - **The plaintext is never logged.** Not on success, not on failure, not truncated. Rule 1 forbids
 *   logging a secret, and a code in a log file is a spendable code.
 * - **It is returned exactly once**, in the response to the purchase that created it.
 * - **Redemption locks the row.** `SELECT … FOR UPDATE` before the balance moves, so two requests
 *   racing the same code — a double tap, a retried request — cannot both credit a wallet.
 *
 * ## Why redeeming means "transfer to the wallet"
 *
 * Bashar, 2026-08-11: a code should "receive money in his wallet". The schema also supports spending a
 * card directly against a booking (`gift_card_transactions.booking_id`), and that seam is left intact
 * for when checkout grows a gift-card leg — but the customer-facing flow moves the whole balance to
 * the wallet, where it composes with every other payment method instead of only one.
 *
 * The transfer is ALL of the remaining balance, not part of it. A partial transfer would leave a
 * customer holding a card AND a balance, needing to remember which is which; and `wallet_txn_reason`
 * already carries `gift_card_transfer`, which is the movement this writes.
 *
 * ## Why buying is funded from the wallet
 *
 * `payments.booking_id` is `NOT NULL`, so the payments table cannot record a purchase that is not for
 * a stay. Making it nullable and adding a gift-card leg is a money-path migration with ledger
 * consequences — recorded in `docs/FUTURE-WORK.md` rather than done in passing. A wallet debit is a
 * complete, correct purchase today: it refuses rather than going negative, it is audited, and it uses
 * the same locking as every other movement.
 *
 * And only the CASH part of that balance may pay for it — never money that arrived from another gift
 * card. Otherwise a gift could be poured from card to card forever, resetting its expiry each time and
 * turning a balance tied to one account into a bearer instrument. See `WalletService.composition`.
 */
@Injectable()
export class GiftCardService {
  private readonly logger = new Logger(GiftCardService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly ledger: LedgerService,
    private readonly fx: FxRateService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * One balanced group for a card's movement, in the CARD's own currency.
   *
   * ## Why the whole domain now posts
   *
   * `gift_card_redemption` was a ledger account with no writer: a card was bought, given away and
   * spent entirely outside `ledger_entries`. So a live card — money SAFRA owes whoever holds it —
   * appeared nowhere in the books, and redeeming one discharged nothing. Same objection Bashar
   * raised about compensation and about profile claims, and gift cards were the last domain outside
   * the accounting model.
   *
   * `gift_card_redemption` is the LIABILITY. The other leg says where it came from or went:
   * `wallet_debit` when a customer paid for it, `gift_card_issued` when SAFRA gave it away,
   * `wallet_credit` when it is spent or returned.
   *
   * ## In the card's currency, at the card's amount
   *
   * A group carries one currency, and a redemption can land in a wallet denominated in another. The
   * liability being created or discharged is the CARD's, so that is what is booked; the converted
   * figure the wallet actually moved by lives on the wallet transaction. In SYP — the unit the
   * balance trigger checks — they are the same number. Same reasoning `postPartnerFine` gives.
   *
   * ## It needs an FX rate, and that is not a side effect
   *
   * Every ledger entry carries `amount_syp`, so a currency with no rate to SYP cannot be booked and
   * this REFUSES. On 2026-08-26 that is EUR: a EUR card cannot be issued until a rate exists. That
   * is the correct failure — a liability SAFRA cannot value in its accounting currency should not
   * be created silently — and it is one configuration value away. Register item 196.
   */
  private async postCardLegs(
    tx: Database,
    legs: LedgerLeg[],
    context: {
      currencyCode: string;
      currencyId: string;
      customerProfileId?: string | undefined;
      createdByUserId?: string | undefined;
    },
  ): Promise<void> {
    await this.ledger.post(tx, legs, {
      currencyId: context.currencyId,
      fxRateToSyp: await this.fx.rateToSyp(context.currencyCode),
      customerProfileId: context.customerProfileId,
      createdByUserId: context.createdByUserId,
    });
  }

  /** The caller's own customer profile, or a refusal. No endpoint here accepts a customer id. */
  private profileOf(claims: AccessTokenClaims | undefined): string {
    if (!claims) throw unauthorized(ERROR.AUTH_REQUIRED);

    const profileId = claims.customerProfileId;

    /* A staff or partner token has no customer account, so no wallet to credit and no cards to list. */
    if (!profileId) throw notFound(ERROR.CUSTOMER_NOT_FOUND);

    return profileId;
  }

  private summaryOf(row: CardRow): GiftCardSummary {
    return {
      reference: row.reference,
      codeLast4: row.code_last4,
      originalAmount: row.original_amount,
      remainingAmount: row.remaining_amount,
      currencyCode: row.currency_code,
      status: row.status,
      expiresAt: row.expires_at,
      recipientName: row.recipient_name,
      recipientEmail: row.recipient_email,
      createdAt: row.created_at,
    };
  }

  /**
   * Turns a code into wallet balance.
   *
   * Every refusal below is decided BEFORE anything moves, and the whole thing is one transaction: the
   * card is emptied, its ledger row is written, and the wallet is credited together, or none of it
   * happens. A crash between those steps would otherwise either lose the money or duplicate it.
   */
  async redeem(
    claims: AccessTokenClaims | undefined,
    rawCode: string,
  ): Promise<GiftCardRedeemResult> {
    const profileId = this.profileOf(claims);
    const normalised = normaliseGiftCode(rawCode);

    return this.db.transaction(async (tx) => {
      /*
        Locked on the way in, by HASH.

        The unique index makes this one lookup rather than a scan, and `FOR UPDATE` means a second
        request for the same code waits here and then finds the balance already at zero — instead of
        both reading a positive balance and both crediting a wallet.
      */
      const found = await tx.execute<CardRow>(sql`
        SELECT g.id, g.reference, g.code_last4,
               g.original_amount::text  AS original_amount,
               g.remaining_amount::text AS remaining_amount,
               g.currency_id, cur.code  AS currency_code,
               g.status::text           AS status,
               g.expires_at::text       AS expires_at,
               g.recipient_name, g.recipient_email,
               g.created_at::text       AS created_at,
               g.purchased_by_customer_id
        FROM gift_cards g
        JOIN currencies cur ON cur.id = g.currency_id
        WHERE g.code_hash = ${hashCode(normalised)}
          AND g.deleted_at IS NULL
        FOR UPDATE OF g
      `);

      const card = found.rows.at(0);

      /*
        One answer for "no such code" and for "malformed".

        A distinct "that code does not exist" would let somebody probing confirm which strings are real
        cards other people hold. The states below are reported specifically, because reaching them
        means the caller is holding a card that genuinely existed.
      */
      if (!card) throw badRequest(ERROR.GIFT_CARD_CODE_INVALID);

      if (card.status === 'cancelled') throw badRequest(ERROR.GIFT_CARD_CANCELLED);

      if (card.expires_at && new Date(card.expires_at).getTime() <= Date.now()) {
        throw badRequest(ERROR.GIFT_CARD_EXPIRED);
      }

      if (card.status !== 'active' || Number(card.remaining_amount) <= 0) {
        throw badRequest(ERROR.GIFT_CARD_ALREADY_USED);
      }

      const amount = card.remaining_amount;

      /*
        The card is emptied in the SAME statement that checks it is still full.

        `remaining_amount = original_amount` in the WHERE is a second guard behind the row lock: if
        anything has already drawn on this card, the update matches nothing and the transaction aborts
        rather than crediting a wallet from a card that has been partly spent elsewhere.
      */
      const emptied = await tx.execute<{ id: string }>(sql`
        UPDATE gift_cards
        SET remaining_amount = 0, status = 'used', updated_at = now()
        WHERE id = ${card.id}::uuid
          AND remaining_amount = ${amount}::numeric
          AND status = 'active'
        RETURNING id
      `);

      if (!emptied.rows.at(0)) throw badRequest(ERROR.GIFT_CARD_ALREADY_USED);

      /* Append-only by trigger: this row is the card's history and cannot be rewritten. */
      await tx.execute(sql`
        INSERT INTO gift_card_transactions
          (gift_card_id, amount, balance_after, created_by_user_id)
        VALUES (${card.id}::uuid, ${amount}::numeric, 0, ${claims?.sub ?? null})
      `);

      /*
        The wallet decides the currency, not this service.

        `credit` converts into the wallet's own currency when they differ, using the FX rate — so a USD
        card redeemed into a EUR wallet is one conversion at a known rate, recorded on the movement.
      */
      const movement = await this.wallet.credit(tx as unknown as Database, {
        customerProfileId: profileId,
        amount,
        currencyId: card.currency_id,
        reason: 'gift_card_transfer',
        createdByUserId: claims?.sub,
      });

      /* The card's liability is discharged and the wallet's is created — see `postCardLegs`. */
      await this.postCardLegs(
        tx as unknown as Database,
        [
          {
            account: 'gift_card_redemption',
            direction: 'debit',
            amount,
            description: `Gift card ${card.reference} redeemed`,
          },
          {
            account: 'wallet_credit',
            direction: 'credit',
            amount,
            description: `Balance credited from gift card ${card.reference}`,
          },
        ],
        {
          currencyCode: card.currency_code,
          currencyId: card.currency_id,
          customerProfileId: profileId,
          createdByUserId: claims?.sub,
        },
      );

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'gift_card.redeem',
          subjectType: 'gift_card',
          subjectId: card.id,
          before: { status: card.status, remainingAmount: amount },
          /*
            Never the code, and never the last four either — an audit row is read by staff, and the
            reference already identifies the card without narrowing anybody's guess at its code.
          */
          after: { status: 'used', remainingAmount: '0', reference: card.reference },
        },
        tx as unknown as Database,
      );

      /* Reference and amount only. A code in a log line is a spendable code. */
      this.logger.log(
        `Gift card ${card.reference} redeemed for ${amount} ${card.currency_code}.`,
      );

      return {
        reference: card.reference,
        creditedAmount: amount,
        creditedCurrency: card.currency_code,
        walletBalance: movement.balance,
        walletCurrency: movement.currencyCode,
      };
    });
  }

  /**
   * Buys a card, paid for out of the buyer's wallet.
   *
   * The code is generated here, hashed immediately, and the plaintext exists only in the return value.
   */
  async purchase(
    claims: AccessTokenClaims | undefined,
    input: GiftCardPurchaseInput,
  ): Promise<GiftCardPurchaseResult> {
    const profileId = this.profileOf(claims);

    const result = await this.db.transaction(async (tx) => {
      /*
        Checked FIRST, so a refusal happens before a card exists — a live, spendable card behind a
        failed payment is the one outcome that must not be possible.

        `debit` will not go negative either, since the wallet is SAFRA's liability to the customer
        rather than a credit line. That is the floor; the rule below is stricter.
      */
      const wallet = await this.wallet.composition(profileId);

      if (!wallet) throw badRequest(ERROR.WALLET_INSUFFICIENT_BALANCE);

      /*
        A card may only be bought with money the customer could otherwise have BACK — the
        withdrawable part of the balance (Bashar, 2026-08-11, widened 2026-09-01).

        The original rule was «not gift money»: gift money poured into a fresh card resets whatever
        expiry the old one carried, and turns a non-transferable balance into a bearer instrument
        somebody else can spend. The wallet is where a gift ENDS.

        Compensation is now on the same side of that line, and for the stronger version of the same
        reason. A gift card is transferable and, unlike a booking, it leaves the platform in
        somebody else's hands — so «compensation stays inside the SAFRA ecosystem» would be a rule
        anybody could walk around by buying a card with it. `restrictedBalance` is gift money and
        compensation together, which is exactly the set that may not become a bearer instrument.

        Exact arithmetic, not `Number()`. This compares money and decides whether to refuse; it was
        comparing two doubles, in a file that computes every other amount in minor units.
      */
      const withdrawable = toMinor(withdrawableOf(wallet), MONEY_SCALE);
      const wanted = toMinor(input.amount, MONEY_SCALE);

      if (withdrawable < wanted) {
        /*
          Two different refusals, because they need two different sentences. Somebody holding $35 who is
          told their balance is insufficient for a $25 card has been told something untrue; the reason is
          the SOURCE of the money, not the amount of it.
        */
        throw badRequest(
          toMinor(wallet.balance, MONEY_SCALE) >= wanted
            ? ERROR.GIFT_CARD_CASH_ONLY
            : ERROR.WALLET_INSUFFICIENT_BALANCE,
        );
      }

      const paid = await this.wallet.debit(tx as unknown as Database, {
        customerProfileId: profileId,
        amount: input.amount,
        currencyId: wallet.currencyId,
        reason: 'gift_card_transfer',
        /*
          And the same rule inside the lock, where it is the one that counts. The check above is
          read outside it and is there to give the better refusal; this is what actually stops a
          card being bought with restricted money when two requests arrive together.
        */
        from: 'withdrawable',
        createdByUserId: claims?.sub,
      });

      const code = generateCode();

      const created = await tx.execute<CardRow>(sql`
        INSERT INTO gift_cards
          (code_hash, code_last4, original_amount, remaining_amount, currency_id,
           status, purchased_by_customer_id, recipient_name, recipient_email)
        VALUES (${hashCode(code)}, ${code.slice(-4)},
                ${input.amount}::numeric, ${input.amount}::numeric, ${wallet.currencyId}::uuid,
                'active', ${profileId}::uuid,
                ${input.recipientName ?? null}, ${input.recipientEmail ?? null})
        RETURNING id, reference, code_last4,
                  original_amount::text  AS original_amount,
                  remaining_amount::text AS remaining_amount,
                  currency_id,
                  status::text     AS status,
                  expires_at::text AS expires_at,
                  recipient_name, recipient_email,
                  created_at::text AS created_at,
                  purchased_by_customer_id
      `);

      const row = created.rows.at(0);

      if (!row) throw badRequest(ERROR.GIFT_CARD_AMOUNT_INVALID);

      /* The customer's balance became SAFRA's liability on a card — see `postCardLegs`. */
      await this.postCardLegs(
        tx as unknown as Database,
        [
          {
            account: 'wallet_debit',
            direction: 'debit',
            amount: paid.appliedAmount,
            description: `Gift card ${row.reference} bought from wallet balance`,
          },
          {
            account: 'gift_card_redemption',
            direction: 'credit',
            amount: paid.appliedAmount,
            description: `Gift card ${row.reference} outstanding`,
          },
        ],
        {
          currencyCode: wallet.currencyCode,
          currencyId: wallet.currencyId,
          customerProfileId: profileId,
          createdByUserId: claims?.sub,
        },
      );

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'gift_card.purchase',
          subjectType: 'gift_card',
          subjectId: row.id,
          before: null,
          /* The reference and the amount. Not the code, and not the hash. */
          after: {
            reference: row.reference,
            amount: input.amount,
            currencyCode: wallet.currencyCode,
            recipientEmail: input.recipientEmail ?? null,
          },
        },
        tx as unknown as Database,
      );

      this.logger.log(
        `Gift card ${row.reference} purchased for ${input.amount} ${wallet.currencyCode}.`,
      );

      return {
        card: {
          ...this.summaryOf({ ...row, currency_code: wallet.currencyCode }),
        },
        /* The one and only time this leaves the server. */
        code: group(code),
        walletBalance: paid.balance,
        walletCurrency: paid.currencyCode,
      };
    });

    /*
      The code, emailed to the buyer (Bashar, 2026-08-18).

      ## After the transaction, never inside it

      An SMTP call inside `db.transaction` holds a database transaction open across a network round
      trip to a third party. The card is already committed by the time this runs, which is also the
      right order for the failure case: a mail that does not go out must not un-buy a card the
      customer has paid for.

      ## Not through the queue, and this is the interesting part

      Everything else notifies through BullMQ. A queued job carries its payload in REDIS, where
      `DEFAULT_JOB_OPTIONS` keeps a completed job for a day and a FAILED one until somebody moves it.
      A gift code is cash, so that payload would be cash sitting in a cache — indefinitely, on the
      exact path where something already went wrong. `gift_cards` deliberately stores only a hash;
      routing the plaintext through a queue would undo that decision from the side.

      So it is sent here, in the request, from a value that never leaves the process. The cost is an
      SMTP call on a purchase — the same trade `docs/FUTURE-WORK.md` §7b deviation 1 accepted for
      low-volume notices, and a card purchase is one.

      `MailService.send` swallows delivery errors, so a mail server that refuses cannot fail a
      purchase that already succeeded.
    */
    await this.deliver(result, claims);

    return result;
  }

  /**
   * Issues a card SAFRA is giving away — §9.3's «+ إنشاء بطاقة هدية».
   *
   * ## Not a purchase with the payment removed
   *
   * `purchase()` debits a customer's wallet; nobody pays for this one. It is a liability SAFRA
   * creates deliberately — goodwill, a service failure, a campaign — so the things that matter are
   * different: WHO issued it (`issued_by_user_id`, a column that had no writer at all until now),
   * WHY (on the audit row), and that the amount is what the person meant.
   *
   * `purchased_by_customer_id` stays null, which is exactly true: nobody bought it.
   *
   * ## The code is returned ONCE and can never be recovered
   *
   * Only `code_hash` is stored. The plaintext exists in this return value and, if an address was
   * given, in one email. A staff member who loses it reissues rather than looks it up — the same
   * rule the console screen already states, and the reason بطاقات الهدايا shows four characters.
   *
   * ## The reason never reaches the customer
   *
   * It goes on the audit row and nowhere else. `giftCardReceivedMail` carries no free text by
   * design — see the note on that template — because a mail SAFRA sends to an address a caller
   * chose, carrying words a caller wrote, is a phishing primitive that costs the price of a card.
   */
  async issue(
    claims: AccessTokenClaims | undefined,
    input: GiftCardIssueInput,
  ): Promise<GiftCardIssueResult> {
    if (!claims?.sub) throw badRequest(ERROR.INTERNAL_ACTOR_REQUIRED);

    /*
      Checked HERE as well as in the schema, and that is not belt-and-braces for its own sake.

      `giftCardIssueSchema` guards the route, so a browser and a crafted request both meet it. This
      guards the SERVICE, which any future caller inside the API reaches without passing a zod pipe
      at all — a seed, a migration, a bulk import, another controller. A gift card is a bearer
      liability SAFRA must honour for as long as it lives, so the list of currencies it can be
      denominated in is an invariant of the thing rather than a property of one route.
    */
    if (!(GIFT_CARD_CURRENCIES as readonly string[]).includes(input.currency)) {
      throw badRequest(ERROR.VALIDATION_CURRENCY_CODE);
    }

    /*
      A card must have somewhere to go, checked here as well as in the schema.

      Only `code_hash` is stored, so a card issued with no address is a liability SAFRA owes to
      somebody who has no way to claim it — the code exists once, in a response, and then nowhere.
      Same reasoning as the currency guard above: this is an invariant of the thing, not a property
      of one route.
    */
    if (!input.recipientEmail?.trim()) throw badRequest(ERROR.VALIDATION_EMAIL_INVALID);

    /*
      The ceiling is a SETTING, read per currency, with the contract's value as the fallback.

      A typo guard belongs where the business can move it — `giftcard.max_issue_usd` and friends,
      alongside `commission.partner_rate` and `booking.same_day_cutoff_hour`. It cannot live in the
      zod schema at all: a field schema cannot read a setting, and the ceiling depends on which
      currency was chosen.
    */
    const ceiling = await this.settings.getNumber(
      giftCardCeilingKey(input.currency),
      DEFAULT_MAX_ISSUED_GIFT_CARD[input.currency],
    );

    if (Number(input.amount) <= 0 || Number(input.amount) > ceiling) {
      throw badRequest(ERROR.GIFT_CARD_AMOUNT_INVALID);
    }

    const currency = await this.db.execute<{ id: string; decimals: number }>(sql`
      SELECT id, decimals FROM currencies WHERE code = ${input.currency} AND is_active
    `);

    const found = currency.rows.at(0);

    if (!found) throw badRequest(ERROR.GEO_CURRENCY_UNKNOWN);

    /*
      Refused, not rounded, when the amount is finer than its currency.

      The field schema allows three decimals because JOD needs three and cannot see WHICH currency
      this is. An operator who typed 10.005 USD is told, rather than discovering afterwards that
      SAFRA issued 10.01. Same rule, and the same reasoning, as a wallet adjustment.
    */
    if (Number(quantise(input.amount, Number(found.decimals))) !== Number(input.amount)) {
      throw badRequest(ERROR.VALIDATION_DECIMAL_STRING);
    }

    const result = await this.db.transaction(async (tx) => {
      const code = generateCode();

      const created = await tx.execute<CardRow>(sql`
        INSERT INTO gift_cards
          (code_hash, code_last4, original_amount, remaining_amount, currency_id,
           status, issued_by_user_id, expires_at, recipient_name, recipient_email)
        VALUES (${hashCode(code)}, ${code.slice(-4)},
                ${input.amount}::numeric, ${input.amount}::numeric, ${found.id}::uuid,
                'active', ${claims.sub}::uuid,
                ${input.expiresOn ?? null}::date,
                ${input.recipientName ?? null}, ${input.recipientEmail ?? null})
        RETURNING id, reference, code_last4,
                  original_amount::text  AS original_amount,
                  remaining_amount::text AS remaining_amount,
                  currency_id,
                  status::text     AS status,
                  expires_at::text AS expires_at,
                  recipient_name, recipient_email,
                  created_at::text AS created_at,
                  purchased_by_customer_id
      `);

      const row = created.rows.at(0);

      if (!row) throw badRequest(ERROR.GIFT_CARD_AMOUNT_INVALID);

      await this.audit.record(
        {
          actorUserId: claims.sub,
          actorRole: claims.role,
          action: 'gift_card.issued',
          subjectType: 'gift_card',
          subjectId: row.id,
          /* The amount, the currency and the reason — never the code, never the hash. */
          after: {
            amount: input.amount,
            currency: input.currency,
            expiresAt: input.expiresOn ?? null,
            recipientEmail: input.recipientEmail ?? null,
          },
          reason: input.reason,
        },
        tx as unknown as Database,
      );

      /* SAFRA gave this away, so the expense is the other side of the liability. */
      await this.postCardLegs(
        tx as unknown as Database,
        [
          {
            account: 'gift_card_issued',
            direction: 'debit',
            amount: input.amount,
            description: `Gift card ${row.reference} issued by staff`,
          },
          {
            account: 'gift_card_redemption',
            direction: 'credit',
            amount: input.amount,
            description: `Gift card ${row.reference} outstanding`,
          },
        ],
        {
          currencyCode: input.currency,
          currencyId: found.id,
          createdByUserId: claims.sub,
        },
      );

      return {
        card: this.summaryOf({ ...row, currency_code: input.currency }),
        code: group(code),
      };
    });

    /*
      Outside the transaction: a mail server refusing must not undo an issued card.
      `MailService` swallows delivery failures and records both outcomes, and the code is on the
      issuing staff member's screen once — so a refused send costs a resend, not the card.
    */
    {
      await this.mail.send(
        giftCardReceivedMail({
          to: input.recipientEmail,
          /* The platform's own default: an issued card has no account to read a preference from. */
          locale: DEFAULT_LOCALE,
          code: result.code,
          reference: result.card.reference,
          amount: `${result.card.originalAmount} ${input.currency}`,
          url: new URL(`/${DEFAULT_LOCALE}/account/gifts`, this.env.APP_URL).toString(),
        }),
      );
    }

    this.logger.log(
      `Gift card ${result.card.reference} issued for ${input.amount} ${input.currency} ` +
        `by ${claims.sub}.`,
    );

    return result;
  }

  /**
   * Voids a live card — §9.3's «إلغاء», and the fourth status finally gets a writer.
   *
   * ## Only a LIVE card
   *
   * `used`, `expired` and `cancelled` are all refused. Cancelling a spent card would rewrite what
   * happened; cancelling an expired one changes nothing and hides which of the two it was.
   *
   * ## Where the money goes depends on who paid for it
   *
   * A card somebody BOUGHT is their money. Voiding it without returning the value would be taking
   * it, so the remaining balance goes back to the buyer's wallet — through `WalletService`, like
   * every other movement. A card SAFRA ISSUED cost the customer nothing, so voiding it simply
   * reverses SAFRA's own expense.
   *
   * Both post a balanced group. The liability leaves `gift_card_redemption` either way; the other
   * leg is where it went.
   */
  async cancel(
    claims: AccessTokenClaims | undefined,
    reference: string,
    input: GiftCardCancelInput,
  ): Promise<GiftCardSummary> {
    if (!claims?.sub) throw badRequest(ERROR.INTERNAL_ACTOR_REQUIRED);

    return this.db.transaction(async (tx) => {
      /*
        Locked on the way in, so a redemption racing this one waits and then finds the card
        cancelled rather than both succeeding — the same reason `redeem()` takes the row lock.
      */
      const rows = await tx.execute<CardRow & { currency_code: string }>(sql`
        SELECT g.id, g.reference, g.code_last4,
               g.original_amount::text  AS original_amount,
               g.remaining_amount::text AS remaining_amount,
               g.currency_id, cur.code  AS currency_code,
               g.status::text     AS status,
               g.expires_at::text AS expires_at,
               g.recipient_name, g.recipient_email,
               g.created_at::text AS created_at,
               g.purchased_by_customer_id
        FROM gift_cards g
        JOIN currencies cur ON cur.id = g.currency_id
        WHERE g.reference = ${reference}
        FOR UPDATE OF g
      `);

      const card = rows.rows.at(0);

      if (!card) throw notFound(ERROR.GIFT_CARD_NOT_FOUND);

      /*
        Expiry is decided HERE, not read from the column.

        `gift-card-expiry` retires cards hourly, so a card that lapsed forty minutes ago still says
        `active`. Cancelling it would record a void for something that had already stopped being
        spendable — and the two are different facts an operator may later need to tell apart.
      */
      const lapsed =
        card.expires_at !== null && new Date(card.expires_at).getTime() <= Date.now();

      if (card.status !== 'active' || lapsed) {
        throw badRequest(ERROR.GIFT_CARD_NOT_CANCELLABLE);
      }

      const remaining = card.remaining_amount;

      const voided = await tx.execute<{ id: string }>(sql`
        UPDATE gift_cards
        SET status = 'cancelled', remaining_amount = 0, updated_at = now()
        WHERE id = ${card.id}::uuid AND status = 'active'
        RETURNING id
      `);

      if (!voided.rows.at(0)) throw badRequest(ERROR.GIFT_CARD_NOT_CANCELLABLE);

      /* Append-only by trigger: the card's history, and this is part of it. */
      await tx.execute(sql`
        INSERT INTO gift_card_transactions
          (gift_card_id, amount, balance_after, created_by_user_id)
        VALUES (${card.id}::uuid, ${remaining}::numeric, 0, ${claims.sub}::uuid)
      `);

      const buyer = card.purchased_by_customer_id;

      if (buyer) {
        /*
          They paid for it, so they get it back. `gift_card_transfer` is the reason because that is
          what this movement IS — value leaving a card for a wallet — and it keeps the balance out
          of `composition`'s cash part, so a returned gift cannot be poured into a fresh card and
          have its expiry reset. See the note on `purchase`.
        */
        await this.wallet.credit(tx as unknown as Database, {
          customerProfileId: buyer,
          amount: remaining,
          currencyId: card.currency_id,
          reason: 'gift_card_transfer',
          createdByUserId: claims.sub,
        });
      }

      await this.postCardLegs(
        tx as unknown as Database,
        [
          {
            account: 'gift_card_redemption',
            direction: 'debit',
            amount: remaining,
            description: `Gift card ${card.reference} cancelled`,
          },
          buyer
            ? {
                account: 'wallet_credit',
                direction: 'credit',
                amount: remaining,
                description: `Balance returned for cancelled gift card ${card.reference}`,
              }
            : {
                account: 'gift_card_issued',
                direction: 'credit',
                amount: remaining,
                description: `Issued gift card ${card.reference} cancelled`,
              },
        ],
        {
          currencyCode: card.currency_code,
          currencyId: card.currency_id,
          customerProfileId: buyer ?? undefined,
          createdByUserId: claims.sub,
        },
      );

      await this.audit.record(
        {
          actorUserId: claims.sub,
          actorRole: claims.role,
          action: 'gift_card.cancelled',
          subjectType: 'gift_card',
          subjectId: card.id,
          before: { status: 'active', remainingAmount: remaining },
          /* The reference identifies it; the code never appears, here or anywhere. */
          after: {
            status: 'cancelled',
            reference: card.reference,
            returnedToBuyer: buyer !== null,
          },
          reason: input.reason,
        },
        tx as unknown as Database,
      );

      this.logger.log(`Gift card ${card.reference} cancelled by ${claims.sub}.`);

      return this.summaryOf({ ...card, remaining_amount: '0', status: 'cancelled' });
    });
  }

  /**
   * Sends the code — to the buyer, and to the recipient when the card names one.
   *
   * ## The buyer is told even when it is a gift
   *
   * They paid for it, and they are the only one who can act if the recipient's address was mistyped
   * — which cannot be repaired any other way, because we keep no copy of the code. A surprise that
   * silently went nowhere is worse than a surprise the buyer can forward.
   *
   * ## The recipient's address comes from the request, and that is the point
   *
   * Everywhere else in this service an address from a caller would be a way to redirect cash. Here it
   * IS the feature: a gift card is bought for somebody. It is bounded by what it costs — a card is
   * paid for out of the buyer's own non-gift balance before this runs — and by the two mails carrying
   * no user-authored text at all, so neither can be used to put a sentence in front of a stranger
   * under SAFRA's name. See `giftCardReceivedMail`.
   *
   * ## Locale
   *
   * The recipient's language is unknown — they may have no account. The buyer's preference is the
   * only signal available and a better guess than the default, since a gift is usually bought inside
   * one market.
   */
  private async deliver(
    result: GiftCardPurchaseResult,
    claims: AccessTokenClaims | undefined,
  ): Promise<void> {
    const profileId = this.profileOf(claims);

    const rows = await this.db.execute<{ email: string; preferred_locale: string }>(sql`
      SELECT email, preferred_locale FROM customer_profiles WHERE id = ${profileId}::uuid
    `);

    const buyer = rows.rows.at(0);

    if (!buyer) return;

    const shared = {
      locale: buyer.preferred_locale,
      code: result.code,
      reference: result.card.reference,
      amount: `${result.card.originalAmount} ${result.card.currencyCode}`,
      /* From configured `APP_URL`, never a request header — see `account-recovery.service.ts`. */
      url: new URL(
        `/${buyer.preferred_locale}/account/gifts`,
        this.env.APP_URL,
      ).toString(),
    };

    await this.mail.send(giftCardPurchasedMail({ to: buyer.email, ...shared }));

    const recipient = result.card.recipientEmail;

    /* Not to themselves twice: a buyer may name their own address. */
    if (recipient && recipient.toLowerCase() !== buyer.email.toLowerCase()) {
      await this.mail.send(giftCardReceivedMail({ to: recipient, ...shared }));
    }

    /*
      Nothing logged here on purpose.

      `MailService` already records both outcomes with the subject and the recipient, and it SWALLOWS
      delivery errors — so a line here saying the code was emailed would be written just as happily
      when the mail server refused. Observed doing exactly that against a dev box with no SMTP on
      1025. A log that asserts what it cannot know is worse than no log, and it would be the line an
      investigation trusted while a customer sat holding an unusable card.
    */
  }

  /** The cards this customer bought — never their codes. */
  async list(claims: AccessTokenClaims | undefined, query: GiftCardQuery) {
    const profileId = this.profileOf(claims);

    let after: { sortKey: string; id: string } | null = null;

    if (query.cursor !== undefined) {
      const decoded = decodeCursor(query.cursor);

      if (!decoded || !UUID_PATTERN.test(decoded.id)) {
        throw badRequest(ERROR.REQUEST_CURSOR_INVALID);
      }

      after = { sortKey: decoded.sortKey, id: decoded.id };
    }

    const keyset = after
      ? sql`AND (g.created_at, g.id) < (${after.sortKey}::timestamptz, ${after.id}::uuid)`
      : sql``;

    /* `gift_cards_purchaser_idx` covers this filter. */
    const rows = await this.db.execute<CardRow>(sql`
      SELECT g.id, g.reference, g.code_last4,
             g.original_amount::text  AS original_amount,
             g.remaining_amount::text AS remaining_amount,
             g.currency_id, cur.code  AS currency_code,
             g.status::text           AS status,
             g.expires_at::text       AS expires_at,
             g.recipient_name, g.recipient_email,
             g.created_at::text       AS created_at,
             g.purchased_by_customer_id
      FROM gift_cards g
      JOIN currencies cur ON cur.id = g.currency_id
      WHERE g.purchased_by_customer_id = ${profileId}::uuid
        AND g.deleted_at IS NULL
        ${keyset}
      ORDER BY g.created_at DESC, g.id DESC
      LIMIT ${query.limit + 1}
    `);

    const page = rows.rows.slice(0, query.limit);
    const last = page.at(-1);

    return {
      items: page.map((row) => this.summaryOf(row)),
      nextCursor:
        rows.rows.length > query.limit && last
          ? encodeCursor(last.created_at, last.id)
          : null,
    };
  }
}
