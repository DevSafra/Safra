import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from './token.service.js';
import { notFound, unauthorized } from '../common/errors/app-error.js';

/**
 * What the customer account screens need about the person reading them.
 *
 * Handoff §6 asks for two things this answers together: a greeting by NAME («أهلاً رامي») and badges
 * on three of the eight sidebar items. Neither was reachable before — the session cookie carries
 * `id`, `email`, `role` and `permissions` but no name, and `GET /auth/me` echoes the token's claims
 * rather than reading `customer_profiles`.
 *
 * ## Why profile and counters in ONE answer
 *
 * The sidebar is on every account page, so whatever feeds it is fetched on every account page. Three
 * separate reads per navigation is what the console rejected on cost, and this project has already
 * been bitten by per-render request volume against a shared rate limit. One row, one round trip,
 * everything the frame needs — the same bargain the partner portal strikes with its profile read.
 *
 * ## It takes no id
 *
 * The customer profile id comes from the VERIFIED token, never from the request. "Show me somebody
 * else's account summary" is a question this endpoint cannot be asked — the same reasoning the
 * console's preferences endpoint records.
 */
@Injectable()
export class CustomerAccountService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async summary(claims: AccessTokenClaims | undefined) {
    if (!claims) throw unauthorized(ERROR.AUTH_REQUIRED);

    /*
      A customer, identified by the profile id the token carries.

      A staff member holds no `customerProfileId`, so they get the same 404 as a deleted profile —
      there is no customer account behind a staff token, and saying so in different words would only
      tell a caller which kind of principal they are.
    */
    const profileId = claims.customerProfileId;

    if (!profileId) throw notFound(ERROR.CUSTOMER_NOT_FOUND);

    /*
      One statement, three counters as scalar subqueries.

      Both counts are over ONE customer's rows through `bookings_customer_idx`
      (`customer_profile_id, created_at`), so neither grows with the size of the table — which is what
      rule 2 is about. An uncapped `count(*)` over a whole registry would be a different matter, and
      that is why the console caps its own.
    */
    const found = await this.db.execute<{
      reference: string;
      full_name: string;
      email: string;
      phone: string;
      preferred_locale: string;
      bookings_count: string;
      pending_reviews: string;
      wallet_balance: string | null;
      wallet_currency: string | null;
    }>(sql`
      SELECT cp.reference,
             cp.full_name,
             cp.email,
             cp.phone,
             cp.preferred_locale,
             (SELECT count(*) FROM bookings b
               WHERE b.customer_profile_id = cp.id
                 AND b.deleted_at IS NULL)::text        AS bookings_count,
             -- The same predicate pendingForCustomer uses, so the badge cannot disagree with the list.
             (SELECT count(*) FROM bookings b
               WHERE b.customer_profile_id = cp.id
                 AND b.status = 'completed'
                 AND b.deleted_at IS NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM reviews r WHERE r.booking_id = b.id
                 ))::text                               AS pending_reviews,
             w.balance::text                            AS wallet_balance,
             cur.code                                   AS wallet_currency
      FROM customer_profiles cp
      LEFT JOIN wallets w      ON w.customer_profile_id = cp.id AND w.deleted_at IS NULL
      LEFT JOIN currencies cur ON cur.id = w.currency_id
      WHERE cp.id = ${profileId}
        AND cp.deleted_at IS NULL
      LIMIT 1
    `);

    const row = found.rows[0];

    if (!row) throw notFound(ERROR.CUSTOMER_NOT_FOUND);

    return {
      reference: row.reference,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      preferredLocale: row.preferred_locale,
      counters: {
        bookings: Number(row.bookings_count),
        pendingReviews: Number(row.pending_reviews),
        /*
          Absent rather than zero when there is no wallet row. A customer who has never been
          compensated has no wallet, which is not the same statement as a balance of nothing — and
          the badge should be missing rather than reading «0».
        */
        walletBalance: row.wallet_balance,
        walletCurrency: row.wallet_currency,
      },
    };
  }
}
