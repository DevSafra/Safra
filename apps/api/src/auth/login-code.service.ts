import { randomInt } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { MailService } from '../mail/mail.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { partnerLoginCodeMail } from '../mail/mail.templates.js';
import { tooManyRequests, unauthorized } from '../common/errors/app-error.js';
import type { RequestContext } from './auth.service.js';

/**
 * The one-time code a partner is emailed at every sign-in (Bashar, 2026-08-20).
 *
 * ## What it replaced, and what it did not
 *
 * Partners used to enrol a TOTP app, which was mandatory before they could use the portal at all.
 * That is now an upgrade a partner may choose rather than a gate they pass — see
 * `AUTHENTICATOR_ROLES`. What did NOT change is that a partner still proves a second factor on
 * every sign-in; only the factor moved, from something they installed to something in their inbox.
 *
 * ## The trade, stated
 *
 * A mailbox is a weaker second factor than an authenticator: whoever reads the partner's email can
 * complete a sign-in, and a mail outage stops every partner signing in. Both were accepted
 * deliberately in exchange for an onboarding a hotel owner can finish without installing anything.
 * Staff were kept on TOTP for exactly the reasons this paragraph lists.
 */

/** Six digits — the length every bank and airline has already taught people to expect. */
const CODE_DIGITS = 6;

/**
 * Ten minutes.
 *
 * Long enough to survive a slow mail queue, a phone fetched from another room and a code typed
 * twice; short enough that a code sitting in an unattended inbox is not a standing key. The mail
 * says the number, so this constant and that sentence have to move together.
 */
const CODE_TTL_MINUTES = 10;

/**
 * Five wrong guesses and the code is dead, whatever the clock says.
 *
 * Six digits is a million possibilities, so guessing is not the threat at any realistic rate. This
 * is here for the other shape: somebody who can watch a partner's screen or shoulder-surf a
 * fragment and wants to brute-force the rest.
 */
const MAX_ATTEMPTS = 5;

/**
 * How many codes one account may ask for, and over how long.
 *
 * The resend button exists because mail is sometimes slow, and a button that can be held down is a
 * way to fill somebody's inbox — the account's OWNER cannot be spammed by a stranger here, since
 * asking for a code requires the password, but a partner leaning on it is still a mail bill and a
 * support call.
 *
 * ## Why not three in fifteen minutes
 *
 * That was the first shape, and it was wrong: this counter does not distinguish a RESEND from an
 * ordinary sign-in, because both send a mail. Three in a quarter of an hour therefore locked out
 * anybody who signed in on their phone, then their laptop, then again after a logout — all
 * ordinary — and the third one got «محاولات كثيرة» with no way forward. The browser suite hit it
 * on the first run and it would have hit a real partner on their first busy morning.
 *
 * Five in five minutes bounds the same thing without that. A held-down button stops after five;
 * somebody genuinely signing in a few times never notices; and the window clears while they are
 * still looking at the form rather than a quarter of an hour later.
 */
const RESEND_LIMIT = 5;
const RESEND_WINDOW_MINUTES = 5;

@Injectable()
export class LoginCodeService {
  private readonly logger = new Logger(LoginCodeService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
  ) {}

  /**
   * Mints a code, stores its hash, and emails the code.
   *
   * ## The code is hashed, and with Argon2id rather than a digest
   *
   * `refresh_tokens` stores a SHA-256 of a 256-bit random token, and that is right for 256 random
   * bits. Six digits is a million possibilities, so a fast digest over a leaked table is a few
   * seconds of work. ~11 ms per verify is nothing against a code attempted at most five times.
   *
   * ## Previous codes are killed first
   *
   * Asking for a new code invalidates the old one. Otherwise every resend leaves another live
   * credential in the mailbox, and a partner who pressed the button three times has three ways in
   * — two of which they have stopped watching for.
   */
  async issue(
    userId: string,
    email: string,
    locale: string,
    context: RequestContext,
  ): Promise<void> {
    await this.enforceResendLimit(userId);

    /* `randomInt` and not `Math.random` — this is a credential. Zero-padded so 000123 is six digits. */
    const code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
    const codeHash = await this.passwords.hash(code);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE login_codes
        SET consumed_at = now()
        WHERE user_id = ${userId}::uuid AND consumed_at IS NULL
      `);

      await tx.execute(sql`
        INSERT INTO login_codes
          (user_id, code_hash, expires_at, ip_address, user_agent)
        VALUES (
          ${userId}::uuid, ${codeHash},
          now() + (${CODE_TTL_MINUTES}::int * INTERVAL '1 minute'),
          ${context.ipAddress ?? null}, ${context.userAgent ?? null}
        )
      `);
    });

    /*
      Sent AFTER the row is committed. A mail that arrives before the code it names exists is a
      partner typing a valid code at a server that has never heard of it.
    */
    await this.mail.send(
      partnerLoginCodeMail({
        to: email,
        code,
        locale,
        expiresInMinutes: CODE_TTL_MINUTES,
      }),
    );

    /* The code itself is NEVER logged — it is a credential, and §1 is explicit. */
    this.logger.log(`Sign-in code issued for user ${userId}.`);
  }

  /**
   * Checks a submitted code against the newest live one for this account.
   *
   * Returns nothing and throws on refusal, so a caller cannot accidentally treat a falsy result as
   * success — the mistake that a boolean invites on an authentication path.
   *
   * ## Wrong, expired and already used answer the SAME thing
   *
   * `auth.email_code_invalid` covers all three. Telling a caller that a code was "expired" rather
   * than "wrong" confirms that the code they hold was once real, which is a fragment worth having
   * if you are working from a screenshot of somebody's notification shade.
   *
   * ## The attempt is counted before the answer is given
   *
   * A wrong guess is recorded whether or not the caller comes back, so five failures kill the code
   * even for somebody who never sees the fifth response.
   */
  async verify(userId: string, submitted: string): Promise<void> {
    const rows = await this.db.execute<{
      id: string;
      code_hash: string;
      attempts: number;
      expired: boolean;
    }>(sql`
      SELECT id, code_hash, attempts, expires_at <= now() AS expired
      FROM login_codes
      WHERE user_id = ${userId}::uuid AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const record = rows.rows[0];

    if (!record || record.expired || record.attempts >= MAX_ATTEMPTS) {
      throw unauthorized(ERROR.AUTH_EMAIL_CODE_INVALID);
    }

    const matches = await this.passwords.verify(record.code_hash, submitted);

    if (!matches) {
      await this.db.execute(sql`
        UPDATE login_codes SET attempts = attempts + 1 WHERE id = ${record.id}::uuid
      `);

      throw unauthorized(ERROR.AUTH_EMAIL_CODE_INVALID);
    }

    /*
      Consumed in the same statement that checks it is still unconsumed, so two requests racing
      with one code cannot both win. A second sign-in has to ask for a second code.
    */
    const spent = await this.db.execute(sql`
      UPDATE login_codes
      SET consumed_at = now()
      WHERE id = ${record.id}::uuid AND consumed_at IS NULL
    `);

    if (spent.rowCount === 0) throw unauthorized(ERROR.AUTH_EMAIL_CODE_INVALID);
  }

  /** Refuses a fourth code inside fifteen minutes. Counted from what was ISSUED, not what was used. */
  private async enforceResendLimit(userId: string): Promise<void> {
    const rows = await this.db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n
      FROM login_codes
      WHERE user_id = ${userId}::uuid
        AND created_at > now() - (${RESEND_WINDOW_MINUTES}::int * INTERVAL '1 minute')
    `);

    if (Number(rows.rows[0]?.n ?? 0) >= RESEND_LIMIT) {
      throw tooManyRequests(ERROR.AUTH_EMAIL_CODE_TOO_MANY);
    }
  }
}
