import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ERROR,
  normaliseCouponCode,
  type ErrorCode,
  type CouponActiveInput,
  type CouponCreateInput,
  type CouponUpdateInput,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../common/audit/audit.service.js';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Creating and maintaining coupons — §9.3's «+ كوبون جديد».
 *
 * ## Separate from `PromotionsService`, which only reads
 *
 * That service answers the registry. This one writes, and the two have different permissions
 * (`COUPON_READ` against `COUPON_MANAGE`), different audit obligations and different failure
 * modes. Keeping the write path in its own service is what makes «who can create money off» a
 * question with one answer.
 *
 * ## A coupon's code and value are set once
 *
 * `couponUpdateSchema` accepts neither. A code is what a customer was told — changing it orphans
 * every poster carrying it. The value is what past redemptions were priced against, and
 * `coupon_redemptions` records what each one gave; a coupon whose worth changes underneath its own
 * history is a record nobody can reconcile. A different offer is a different coupon.
 */
@Injectable()
export class CouponAdminService {
  private readonly logger = new Logger(CouponAdminService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async create(
    claims: AccessTokenClaims | undefined,
    input: CouponCreateInput,
  ): Promise<{ id: string; code: string }> {
    if (!claims?.sub) throw badRequest(ERROR.INTERNAL_ACTOR_REQUIRED);

    return this.db.transaction(async (tx) => {
      const currencyId = input.currency
        ? await this.lookup(
            tx as unknown as Database,
            sql`SELECT id FROM currencies WHERE code = ${input.currency}
                                     AND is_active`,
            ERROR.GEO_CURRENCY_UNKNOWN,
          )
        : null;

      /*
        Scope is resolved from a SLUG and a REFERENCE, never from an id in the request body.

        An internal id in a request is a value a caller can guess at; a slug and a reference are
        what the console already shows, and resolving them here means a coupon can only ever be
        scoped to something that exists and that this reader could already see.
      */
      const cityId = input.citySlug
        ? await this.lookup(
            tx as unknown as Database,
            sql`SELECT id FROM cities WHERE slug = ${input.citySlug}
                                      AND deleted_at IS NULL`,
            ERROR.GEO_CITY_NOT_FOUND,
          )
        : null;

      const partnerId = input.partnerReference
        ? await this.lookup(
            tx as unknown as Database,
            sql`SELECT id FROM partners
                                     WHERE reference = ${input.partnerReference}
                                       AND deleted_at IS NULL`,
            ERROR.PARTNER_NOT_FOUND,
          )
        : null;

      const code = normaliseCouponCode(input.code);

      /*
        `ON CONFLICT DO NOTHING` and a clean 409, rather than letting the unique index surface as a
        500. The index is partial over live rows, so a code freed by a soft delete can be reused —
        which is the behaviour an operator expects after retiring a campaign.
      */
      const created = await tx.execute<{ id: string }>(sql`
        INSERT INTO coupons
          (code, type, value_kind, value, currency_id, max_discount_amount, min_booking_amount,
           starts_at, ends_at, max_redemptions, max_redemptions_per_customer,
           city_id, partner_id, is_active, created_by_user_id)
        VALUES (
          ${code}, ${input.type}::coupon_type, ${input.valueKind}::coupon_value_kind,
          ${input.value}::numeric, ${currencyId}::uuid,
          ${input.maxDiscountAmount ?? null}::numeric,
          ${input.minBookingAmount ?? null}::numeric,
          ${input.startsOn}::date, ${input.endsOn}::date,
          ${input.maxRedemptions ?? null}, ${input.maxRedemptionsPerCustomer ?? null},
          ${cityId}::uuid, ${partnerId}::uuid, true, ${claims.sub}::uuid
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `);

      const row = created.rows.at(0);

      if (!row) throw conflict(ERROR.COUPON_CODE_TAKEN);

      await this.audit.record(
        {
          actorUserId: claims.sub,
          actorRole: claims.role,
          action: 'coupon.created',
          subjectType: 'coupon',
          subjectId: row.id,
          after: {
            code,
            type: input.type,
            valueKind: input.valueKind,
            value: input.value,
            currency: input.currency ?? null,
            startsAt: input.startsOn,
            expiresAt: input.endsOn,
            maxRedemptions: input.maxRedemptions ?? null,
          },
        },
        tx as unknown as Database,
      );

      this.logger.log(`Coupon ${code} created by ${claims.sub}.`);

      return { id: row.id, code };
    });
  }

  /**
   * Edits the parts of a coupon that may change — its window, its caps, its minimum.
   *
   * Every field is optional and `undefined` means "leave it"; `null` means "clear it". Those are
   * different instructions and conflating them is how a `maxRedemptions` gets silently removed by
   * a form that did not send it.
   */
  async update(
    claims: AccessTokenClaims | undefined,
    code: string,
    input: CouponUpdateInput,
  ): Promise<void> {
    if (!claims?.sub) throw badRequest(ERROR.INTERNAL_ACTOR_REQUIRED);

    await this.db.transaction(async (tx) => {
      const before = await this.load(tx as unknown as Database, code);

      const starts = input.startsOn ?? before.starts_at.slice(0, 10);
      const ends = input.endsOn ?? before.ends_at.slice(0, 10);

      /* Checked before the write so an operator is told, rather than meeting a CHECK violation. */
      if (ends <= starts) throw badRequest(ERROR.COUPON_WINDOW_ORDER);

      const set = (
        given: string | number | null | undefined,
        current: unknown,
      ): unknown => (given === undefined ? current : given);

      await tx.execute(sql`
        UPDATE coupons SET
          max_discount_amount = ${set(input.maxDiscountAmount, before.max_discount_amount)}::numeric,
          min_booking_amount  = ${set(input.minBookingAmount, before.min_booking_amount)}::numeric,
          starts_at = ${starts}::date,
          ends_at   = ${ends}::date,
          max_redemptions = ${set(input.maxRedemptions, before.max_redemptions)},
          max_redemptions_per_customer =
            ${set(input.maxRedemptionsPerCustomer, before.max_redemptions_per_customer)},
          updated_at = now()
        WHERE id = ${before.id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: claims.sub,
          actorRole: claims.role,
          action: 'coupon.updated',
          subjectType: 'coupon',
          subjectId: before.id,
          before: {
            startsAt: before.starts_at.slice(0, 10),
            expiresAt: before.ends_at.slice(0, 10),
            maxRedemptions: before.max_redemptions,
          },
          after: {
            startsAt: starts,
            expiresAt: ends,
            maxRedemptions: set(input.maxRedemptions, before.max_redemptions),
          },
        },
        tx as unknown as Database,
      );
    });
  }

  /**
   * The operator's switch, separate from the calendar.
   *
   * Switching a coupon off stops it being redeemed immediately, without touching its window — so a
   * campaign can be paused and resumed. The registry already shows the two together, with expiry
   * winning, because a coupon switched on and past its window is not usable and saying «نشط» would
   * send somebody looking for a bug in checkout.
   */
  async setActive(
    claims: AccessTokenClaims | undefined,
    code: string,
    input: CouponActiveInput,
  ): Promise<void> {
    if (!claims?.sub) throw badRequest(ERROR.INTERNAL_ACTOR_REQUIRED);

    await this.db.transaction(async (tx) => {
      const before = await this.load(tx as unknown as Database, code);

      await tx.execute(sql`
        UPDATE coupons SET is_active = ${input.isActive}, updated_at = now()
        WHERE id = ${before.id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: claims.sub,
          actorRole: claims.role,
          action: input.isActive ? 'coupon.activated' : 'coupon.deactivated',
          subjectType: 'coupon',
          subjectId: before.id,
          before: { isActive: before.is_active },
          after: { isActive: input.isActive, code: before.code },
        },
        tx as unknown as Database,
      );

      this.logger.log(
        `Coupon ${before.code} ${input.isActive ? 'activated' : 'deactivated'} by ${claims.sub}.`,
      );
    });
  }

  private async load(tx: Database, code: string) {
    const rows = await tx.execute<{
      id: string;
      code: string;
      starts_at: string;
      ends_at: string;
      max_discount_amount: string | null;
      min_booking_amount: string | null;
      max_redemptions: number | null;
      max_redemptions_per_customer: number | null;
      is_active: boolean;
    }>(sql`
      SELECT id, code, starts_at::text AS starts_at, ends_at::text AS ends_at,
             max_discount_amount::text AS max_discount_amount,
             min_booking_amount::text  AS min_booking_amount,
             max_redemptions, max_redemptions_per_customer, is_active
      FROM coupons WHERE code = ${normaliseCouponCode(code)} AND deleted_at IS NULL
    `);

    const found = rows.rows.at(0);

    if (!found) throw notFound(ERROR.COUPON_NOT_FOUND);

    return found;
  }

  /** One id from a lookup, or the caller's own refusal. */
  private async lookup(
    tx: Database,
    query: ReturnType<typeof sql>,
    code: ErrorCode,
  ): Promise<string> {
    const rows = await tx.execute<{ id: string }>(query);
    const id = rows.rows.at(0)?.id;

    if (!id) throw badRequest(code);

    return id;
  }
}
