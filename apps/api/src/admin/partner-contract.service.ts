import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../common/audit/audit.service.js';
import { StorageService } from '../storage/storage.service.js';
import { MailService } from '../mail/mail.service.js';
import { partnerContractReadyMail } from '../mail/mail.templates.js';
import { ENV, type Env } from '../config/env.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { ERROR } from '@safra/contracts';
import { badRequest, notFound } from '../common/errors/app-error.js';

/** The handoff's ceiling: PDF ≤ 10MB. Also a database CHECK, for every other writer. */
const MAX_BYTES = 10 * 1024 * 1024;

export const uploadContractSchema = z
  .object({
    partnerReference: z.string().min(1).max(32),
    kind: z.enum(['base', 'commission_annex', 'renewal']),
    /** `YYYY-MM-DD`. Optional: a base agreement may be open-ended. */
    expiresAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry must be YYYY-MM-DD.')
      .optional(),
    fileName: z.string().min(1).max(255),
    /** Base64 body. Bounded so a request cannot be used to exhaust memory. */
    content: z
      .string()
      .min(1)
      .max(Math.ceil((MAX_BYTES * 4) / 3) + 1024),
  })
  .strict();

export type UploadContractInput = z.infer<typeof uploadContractSchema>;

export interface ContractRow {
  readonly id: string;
  readonly partnerReference: string;
  readonly partnerName: string;
  readonly kind: string;
  readonly status: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly uploadedBy: string | null;
  readonly uploadedAt: string;
  readonly signedAt: string | null;
  readonly expiresAt: string | null;
  /** Whole days until expiry; null when open-ended, negative once past. */
  readonly daysToExpiry: number | null;
}

/**
 * عقود الشراكة — the commercial contract between SAFRA and a partner (design handoff §8.1).
 *
 * ## Replacing supersedes; it never overwrites
 *
 * The design's action is "استبدال". That inserts a new row and marks the previous one
 * `superseded` — the file is never overwritten and the old row is never deleted. Which terms
 * were in force on the day of a disputed booking is a question that gets asked, and an in-place
 * replacement destroys the only record that can answer it. A partial unique index guarantees
 * only one contract of each kind is `active` per partner.
 *
 * ## PDF only, and checked by looking at the bytes
 *
 * The declared content type is not trusted. A PDF starts with `%PDF-`, and that is what is
 * checked: accepting an executable because the request said `application/pdf` would put an
 * arbitrary file behind an authenticated download link, which is a malware-distribution channel
 * with SAFRA's name on it. Malware SCANNING is still outstanding (S-8) and is a different
 * control — this only establishes the file is the type it claims.
 */
@Injectable()
export class PartnerContractService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Every contract, newest first. Not paginated: a partner has a handful, ever. */
  async list(partnerReference?: string): Promise<ContractRow[]> {
    const filter = partnerReference ? sql`AND p.reference = ${partnerReference}` : sql``;

    const result = await this.db.execute<{
      id: string;
      partner_reference: string;
      partner_name: string;
      kind: string;
      status: string;
      file_name: string;
      size_bytes: number;
      uploaded_by: string | null;
      uploaded_at: string;
      signed_at: string | null;
      expires_at: string | null;
      days_to_expiry: number | null;
    }>(sql`
      SELECT c.id,
             p.reference    AS partner_reference,
             p.display_name AS partner_name,
             c.kind::text   AS kind,
             c.status::text AS status,
             c.file_name, c.size_bytes,
             u.email        AS uploaded_by,
             to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS uploaded_at,
             to_char(c.signed_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS signed_at,
             to_char(c.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS expires_at,
             CASE WHEN c.expires_at IS NULL THEN NULL
                  ELSE floor(extract(epoch FROM (c.expires_at - now())) / 86400)::int
             END AS days_to_expiry
      FROM partner_contracts c
      JOIN partners p     ON p.id = c.partner_id
      LEFT JOIN users u   ON u.id = c.uploaded_by_user_id
      WHERE c.deleted_at IS NULL ${filter}
      ORDER BY c.created_at DESC
      LIMIT 100
    `);

    return result.rows.map((row) => ({
      id: row.id,
      partnerReference: row.partner_reference,
      partnerName: row.partner_name,
      kind: row.kind,
      status: row.status,
      fileName: row.file_name,
      sizeBytes: row.size_bytes,
      uploadedBy: row.uploaded_by,
      uploadedAt: row.uploaded_at,
      signedAt: row.signed_at,
      expiresAt: row.expires_at,
      daysToExpiry: row.days_to_expiry,
    }));
  }

  async upload(
    actor: AccessTokenClaims | undefined,
    input: UploadContractInput,
  ): Promise<ContractRow[]> {
    const bytes = Buffer.from(input.content, 'base64');

    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      throw badRequest(ERROR.CONTRACT_PDF_REQUIRED);
    }

    /*
      Magic bytes, not the declared content type. `%PDF-` is the signature; anything else is
      refused with the same generic message, because telling a caller exactly which check
      failed is a probing aid and the remedy is identical either way.
    */
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw badRequest(ERROR.CONTRACT_PDF_REQUIRED);
    }

    /*
      The partner's own address and language, so the upload can TELL them (Bashar, 2026-08-19).

      Step 4 of «انضم كشريك» is "send the new partner the contract to sign", and a contract that
      appears in a dashboard nobody has been asked to open is not sent. `users.email` rather than
      `partners.email`: the account is what receives platform mail, and the two can differ.
    */
    const partner = await this.db.execute<{
      id: string;
      display_name: string;
      email: string;
      locale: string;
    }>(sql`
      SELECT p.id, p.display_name, u.email, u.preferred_locale AS locale
      FROM partners p
      JOIN users u ON u.id = p.user_id
      WHERE p.reference = ${input.partnerReference} AND p.deleted_at IS NULL
      LIMIT 1
    `);

    const partnerRow = partner.rows[0];
    const partnerId = partnerRow?.id;

    if (!partnerRow || !partnerId) throw notFound(ERROR.PARTNER_NOT_FOUND);

    /*
      The object key is derived from ids, never from the uploaded filename. A filename is
      attacker-controlled and reaches a storage path — `../../` traversal, or a name that
      collides with another partner's file.
    */
    const key = `partner-contracts/${partnerId}/${Date.now()}-${input.kind}.pdf`;

    await this.storage.put(key, bytes, 'application/pdf');

    await this.db.transaction(async (tx) => {
      /*
        Supersede every NON-TERMINAL contract of this kind before inserting, in the same
        transaction.

        "Non-terminal" means `active` OR `awaiting_partner_signature`, not just `active`. The
        first version of this only superseded active ones, and testing showed the consequence
        immediately: uploading a corrected version of an unsigned contract left both rows
        pending, so the list showed two base agreements for one partner with no way to tell
        which was current. Replacing means the previous one is out of play whether or not it
        was ever signed.

        Doing it after the insert would violate the partial unique index; doing it in a separate
        transaction would leave a window with two live contracts, and the commission that
        applies during that window would be ambiguous.
      */
      await tx.execute(sql`
        UPDATE partner_contracts
        SET status = 'superseded'
        WHERE partner_id = ${partnerId}::uuid
          AND kind = ${input.kind}::partner_contract_kind
          AND status IN ('active', 'awaiting_partner_signature')
          AND deleted_at IS NULL
      `);

      const inserted = await tx.execute<{ id: string }>(sql`
        INSERT INTO partner_contracts
          (partner_id, kind, status, file_key, file_name, content_type, size_bytes,
           uploaded_by_user_id, expires_at)
        VALUES (${partnerId}::uuid, ${input.kind}::partner_contract_kind,
                'awaiting_partner_signature', ${key}, ${input.fileName},
                'application/pdf', ${bytes.byteLength}, ${actor?.sub}::uuid,
                ${input.expiresAt ?? null}::timestamptz)
        RETURNING id
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'partner_contract.uploaded',
          subjectType: 'partner_contract',
          subjectId: inserted.rows[0]?.id ?? null,
          /*
            The filename and size are recorded; the CONTENT never is. The handoff requires the
            upload to be audit-logged, which means who/when/what-file — not a copy of the file
            in a table that can never be deleted.
          */
          after: {
            partnerReference: input.partnerReference,
            kind: input.kind,
            fileName: input.fileName,
            sizeBytes: bytes.byteLength,
            expiresAt: input.expiresAt ?? null,
          },
        },
        tx as unknown as Database,
      );
    });

    /*
      After the transaction. A partner told about a contract that then rolled back would open a
      dashboard with nothing in it, and the mail cannot be un-sent.
    */
    await this.mail.send(
      partnerContractReadyMail({
        to: partnerRow.email,
        partner: partnerRow.display_name,
        kind: input.kind,
        /* From the configured base, never from the request — the rule for every link we mail. */
        url: new URL('/contracts', this.env.PARTNER_URL).toString(),
        locale: partnerRow.locale,
      }),
    );

    return this.list(input.partnerReference);
  }

  /**
   * Records that the partner has signed, moving the contract to `active`.
   *
   * ## Why this exists
   *
   * Without it `active` is unreachable: every upload starts `awaiting_partner_signature`, and the
   * design's "ساري حتى 14-01-2027" status could never appear. Testing the upload path is what
   * surfaced that — four contracts uploaded, none active, and a whole branch of the status
   * vocabulary dead.
   *
   * ## It is a separate action, not a flag on upload
   *
   * Uploading is "we have the file"; signing is "both sides are bound". Collapsing them would let
   * an unsigned draft govern a commission, and the partial unique index would then have to
   * arbitrate between two things that are not the same claim.
   */
  async markSigned(
    actor: AccessTokenClaims | undefined,
    id: string,
    signedOn: string,
  ): Promise<ContractRow[]> {
    const found = await this.db.execute<{
      id: string;
      status: string;
      partner_reference: string;
      partner_id: string;
      kind: string;
    }>(sql`
      SELECT c.id, c.status::text AS status, c.kind::text AS kind,
             c.partner_id, p.reference AS partner_reference
      FROM partner_contracts c
      JOIN partners p ON p.id = c.partner_id
      WHERE c.id = ${id}::uuid AND c.deleted_at IS NULL
      LIMIT 1
    `);

    const contract = found.rows[0];

    if (!contract) throw notFound(ERROR.CONTRACT_NOT_FOUND);

    if (contract.status !== 'awaiting_partner_signature') {
      throw badRequest(ERROR.CONTRACT_NOT_AWAITING_SIGNATURE);
    }

    await this.db.transaction(async (tx) => {
      /*
        Any other active contract of this kind is superseded in the same statement sequence, so
        the partial unique index can never see two. This is belt and braces — upload already
        supersedes — because signing is the moment the index constraint actually binds.
      */
      await tx.execute(sql`
        UPDATE partner_contracts SET status = 'superseded'
        WHERE partner_id = ${contract.partner_id}::uuid
          AND kind = ${contract.kind}::partner_contract_kind
          AND status = 'active'
          AND id <> ${contract.id}::uuid
          AND deleted_at IS NULL
      `);

      await tx.execute(sql`
        UPDATE partner_contracts
        SET status = 'active', signed_at = ${signedOn}::timestamptz
        WHERE id = ${contract.id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'partner_contract.signed',
          subjectType: 'partner_contract',
          subjectId: contract.id,
          before: { status: contract.status },
          after: { status: 'active', signedAt: signedOn },
        },
        tx as unknown as Database,
      );
    });

    return this.list(contract.partner_reference);
  }
}
