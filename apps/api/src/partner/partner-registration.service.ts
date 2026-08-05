import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import type { PartnerRegisterInput } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { ERROR } from '@safra/contracts';
import { badRequest, conflict } from '../common/errors/app-error.js';

export interface PartnerRegistrationResult {
  readonly reference: string;
  readonly displayName: string;
  readonly verification: 'pending';
}

/**
 * Partner self-registration (SRS §8.1).
 *
 * Until now partners existed only as hand-written SQL, which meant the whole
 * verification pipeline — the pending queue, sanctions screening, the approve/reject
 * endpoints — was reviewing inventory nobody could actually submit.
 *
 * ## What a self-registered partner can and cannot do
 *
 * They get an account and can build listings immediately, because drafting is how an
 * application is made concrete. What they CANNOT do is publish: §8.1 and principle
 * P-002 put SAFRA between a listing and the public, item 116 blocks publication while
 * the partner is unverified, and ADR 0002 makes sanctions screening a hard
 * precondition for verifying them at all.
 *
 * That containment is what makes an open registration endpoint acceptable. Anyone can
 * apply; nothing they create reaches a customer until a human and a screening check
 * have both passed.
 *
 * ## No response is returned before the record exists
 *
 * Account and partner are created in ONE transaction. A user row without its partner
 * row would be an account with partner permissions and no partner to scope them to —
 * `requirePartnerId` refuses that, so the customer would be locked out of an account
 * they had just been told was created.
 */
@Injectable()
export class PartnerRegistrationService {
  private readonly logger = new Logger(PartnerRegistrationService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async register(
    input: PartnerRegisterInput,
    context: { ipAddress?: string | undefined; userAgent?: string | undefined },
  ): Promise<PartnerRegistrationResult> {
    const [partnerType, city] = await Promise.all([
      this.lookupPartnerType(input.partnerTypeCode),
      this.lookupCity(input.citySlug),
    ]);

    const existing = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM users WHERE lower(email) = lower(${input.email}) AND deleted_at IS NULL
    `);

    if (existing.rows[0]) {
      /**
       * An honest 409, matching customer registration. The form reveals whether an
       * address is taken the moment it refuses to proceed, so concealing it buys no
       * privacy while making the error incomprehensible. Login remains the place
       * where enumeration is actually resisted (ADR 0003).
       */
      throw conflict(ERROR.AUTH_EMAIL_TAKEN);
    }

    const passwordHash = await this.passwords.hash(input.password);

    const created = await this.db.transaction(async (tx) => {
      const userRows = await tx.execute<{ id: string }>(sql`
        INSERT INTO users (email, phone, password_hash, role, preferred_locale)
        VALUES (${input.email}, ${input.phone}, ${passwordHash},
                'partner'::user_role, ${input.preferredLocale})
        RETURNING id
      `);

      const userId = userRows.rows[0]?.id;
      if (!userId) throw new Error('User insert returned no row.');

      /**
       * `verification` is left to its column default of `pending` rather than being
       * written here. One fewer place for an applicant-supplied value to reach, and
       * the default is the thing §8.1 actually depends on.
       */
      const partnerRows = await tx.execute<{ id: string; reference: string }>(sql`
        INSERT INTO partners
          (user_id, partner_type_id, legal_name, display_name, city_id, address,
           phone, email)
        VALUES (${userId}, ${partnerType.id}, ${input.legalName}, ${input.displayName},
                ${city.id}, ${input.address}, ${input.phone}, ${input.email})
        RETURNING id, reference
      `);

      const partner = partnerRows.rows[0];
      if (!partner) throw new Error('Partner insert returned no row.');

      await tx.execute(sql`
        INSERT INTO timeline_events (subject_type, subject_id, event_type, actor_type, payload)
        VALUES ('partner', ${partner.id}, 'partner.registered', 'partner',
                ${JSON.stringify({ city: input.citySlug, type: input.partnerTypeCode })}::jsonb)
      `);

      await this.audit.record(
        {
          actorUserId: userId,
          actorRole: 'partner',
          action: 'partner.registered',
          subjectType: 'partner',
          subjectId: partner.id,
          after: {
            reference: partner.reference,
            legalName: input.legalName,
            city: input.citySlug,
            partnerType: input.partnerTypeCode,
          },
          ...context,
        },
        tx as unknown as Database,
      );

      return partner;
    });

    this.logger.log(
      `Partner ${created.reference} registered in ${input.citySlug}, awaiting verification.`,
    );

    /**
     * No session is issued here.
     *
     * Customer registration signs the person straight in because they are mid-booking
     * and any friction costs a sale. A partner is starting a business relationship
     * that a human will review; sending them to sign in normally keeps ONE code path
     * minting partner sessions — the one with the lockout counter and the 2FA check
     * on it — rather than a second, quieter one here.
     */
    return {
      reference: created.reference,
      displayName: input.displayName,
      verification: 'pending',
    };
  }

  private async lookupPartnerType(code: string): Promise<{ id: string }> {
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM partner_types WHERE code = ${code} AND is_active = true
    `);

    const row = rows.rows[0];

    // The caller's mistake, so a 400 naming the field rather than a generic failure.
    if (!row) throw badRequest(ERROR.PARTNER_TYPE_UNKNOWN);

    return row;
  }

  private async lookupCity(slug: string): Promise<{ id: string }> {
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM cities WHERE slug = ${slug} AND deleted_at IS NULL
    `);

    const row = rows.rows[0];
    if (!row) throw badRequest(ERROR.GEO_CITY_UNKNOWN);

    return row;
  }
}
