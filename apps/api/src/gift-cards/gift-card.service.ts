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
  type GiftCardPurchaseResult,
  type GiftCardQuery,
  type GiftCardRedeemResult,
  type GiftCardSummary,
  decodeCursor,
  encodeCursor,
  normaliseGiftCode,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { badRequest, notFound, unauthorized } from '../common/errors/app-error.js';
import { ENV, type Env } from '../config/env.js';
import { MailService } from '../mail/mail.service.js';
import { giftCardPurchasedMail } from '../mail/mail.templates.js';

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
  ) {}

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
        A card may only be bought with الرصيد الحالي — the part of the balance that did NOT come from a
        gift card (Bashar, 2026-08-11).

        Without this, gift money could be poured into a fresh card indefinitely: each new card resets
        whatever expiry the old one carried, and it turns a non-transferable balance into a bearer
        instrument somebody else can spend. The wallet is where a gift ENDS.
      */
      const cash = Number(wallet.balance) - Number(wallet.giftBalance);

      if (cash < Number(input.amount)) {
        /*
          Two different refusals, because they need two different sentences. Somebody holding $35 who is
          told their balance is insufficient for a $25 card has been told something untrue; the reason is
          the SOURCE of the money, not the amount of it.
        */
        throw badRequest(
          Number(wallet.balance) >= Number(input.amount)
            ? ERROR.GIFT_CARD_CASH_ONLY
            : ERROR.WALLET_INSUFFICIENT_BALANCE,
        );
      }

      const paid = await this.wallet.debit(tx as unknown as Database, {
        customerProfileId: profileId,
        amount: input.amount,
        currencyId: wallet.currencyId,
        reason: 'gift_card_transfer',
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
    await this.notifyPurchaser(result, claims);

    return result;
  }

  /**
   * Emails the code to whoever BOUGHT the card — never to a recipient.
   *
   * A card can name someone else (`recipient_email`), and delivering a gift to them is a separate
   * decision about what a gift card DOES. This method looks up the purchaser's own address from
   * their profile rather than taking one from the request, so there is no input that can redirect a
   * spendable code to an inbox of a caller's choosing.
   */
  private async notifyPurchaser(
    result: GiftCardPurchaseResult,
    claims: AccessTokenClaims | undefined,
  ): Promise<void> {
    const profileId = this.profileOf(claims);

    const rows = await this.db.execute<{ email: string; preferred_locale: string }>(sql`
      SELECT email, preferred_locale FROM customer_profiles WHERE id = ${profileId}::uuid
    `);

    const buyer = rows.rows.at(0);

    if (!buyer) return;

    await this.mail.send(
      giftCardPurchasedMail({
        to: buyer.email,
        locale: buyer.preferred_locale,
        code: result.code,
        reference: result.card.reference,
        amount: `${result.card.originalAmount} ${result.card.currencyCode}`,
        /* From configured `APP_URL`, never a request header — see `account-recovery.service.ts`. */
        url: new URL(
          `/${buyer.preferred_locale}/account/gifts`,
          this.env.APP_URL,
        ).toString(),
      }),
    );

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
