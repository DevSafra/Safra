import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '@safra/db';

import { assertCanRead, assertCanWrite, scopeFilter } from '../rbac/scope.sql.js';
import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../common/audit/audit.service.js';
import { StorageService } from '../storage/storage.service.js';
import { MailService } from '../mail/mail.service.js';
import {
  partnerContractAwaitingSignatureMail,
  partnerContractCountersignedMail,
  partnerContractReadyMail,
  partnerContractReturnedMail,
} from '../mail/mail.templates.js';
import { ENV, type Env } from '../config/env.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { canFileJointContract, ERROR } from '@safra/contracts';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';
import { SettingsService } from '../settings/settings.service.js';
import { renderContractHtml } from './contract-template.js';
import { renderContractPdf } from './contract-pdf.js';
import { actorName } from '../common/actor-name.sql.js';

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

/** Generating the agreement from the template. No file: the platform makes it. */
export const generateContractSchema = z
  .object({
    partnerReference: z.string().min(1).max(32),
    kind: z.enum(['base', 'commission_annex', 'renewal']),
  })
  .strict();

export type GenerateContractInput = z.infer<typeof generateContractSchema>;

/**
 * A hand-signed scan, coming back from either party.
 *
 * No `partnerReference` and no `kind`: the contract id says which document this is, and both are
 * already on it. A caller who could name the partner could name somebody else's.
 */
export const signedCopySchema = z
  .object({
    fileName: z.string().min(1).max(255),
    content: z
      .string()
      .min(1)
      .max(Math.ceil((MAX_BYTES * 4) / 3) + 1024),
  })
  .strict();

export type SignedCopyInput = z.infer<typeof signedCopySchema>;

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
/** One copy either side sent: which side, which day, and whether it still stands. */
export type ContractHistoryEntry = {
  readonly party: string;
  readonly at: string;
  readonly superseded: boolean;
};

/**
 * A contract's version history — ONE definition, joined by both sides of the platform.
 *
 * The console and the partner portal show the same list under the same upload form (Bashar,
 * 2026-08-23), so they read it through the same fragment rather than two queries that happen to
 * agree today. What would drift is not the shape but the two things that carry meaning: the ORDER,
 * and which columns a partner may see.
 *
 * ## Newest first
 *
 * The live copy is the one being acted on, so it goes at the top of the list on both screens.
 *
 * ## Three fields, and the omissions are the point
 *
 * The signature row also holds the uploader's user id, their IP address, their user agent, the
 * file hash and the storage key. None of those cross this boundary. The IP and user agent on a
 * safra row are a STAFF member's — employee PII a partner is not owed — the storage key is a
 * handle to the object store, and the file name is chosen by a staff member and can carry internal
 * notes. The console is held to the same three because Bashar asked for the same list, and because
 * "who did this" is a question the audit log answers properly.
 *
 * The date is cut to the day HERE rather than in either UI: precision that is not displayed should
 * not be sent.
 *
 * ## It expects the contracts table to be aliased c
 *
 * Both callers do. A caller that aliases it otherwise gets a compile-clean query that fails at
 * runtime, which is the one sharp edge of composing SQL this way.
 */
export const contractHistoryJoin = sql`
  LEFT JOIN LATERAL (
    SELECT json_agg(
             json_build_object(
               'party', s.party::text,
               'at', to_char(s.uploaded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
               'superseded', s.superseded_at IS NOT NULL
             )
             ORDER BY s.uploaded_at DESC, s.id DESC
           ) AS history
    FROM partner_contract_signatures s
    WHERE s.contract_id = c.id
  ) h ON TRUE
`;

/** The matching SELECT item. Absent signatures read as an empty list, never as null. */
export const contractHistorySelect = sql`COALESCE(h.history, '[]'::json) AS history`;

@Injectable()
export class PartnerContractService {
  private readonly logger = new Logger(PartnerContractService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(ENV) private readonly env: Env,
    private readonly settings: SettingsService,
  ) {}

  /** Every contract, newest first. Not paginated: a partner has a handful, ever. */
  /**
   * `actor` is REQUIRED and comes FIRST, deliberately.
   *
   * It was optional and second for about ten minutes. That shape re-creates the exact failure the
   * scoping fixes: a call site that forgets it compiles, runs, and silently returns every contract
   * in the country. Required-and-first makes an omission a compile error, which is the only kind
   * of reminder that survives a year.
   */
  async list(
    actor: AccessTokenClaims | undefined,
    partnerReference?: string,
  ): Promise<ContractRow[]> {
    /*
      Scoped through the PARTNER's city, because a contract has none of its own.

      This was the tenth resource the comment in `scope.sql.ts` predicts — "enforced on eight and
      forgotten on the ninth"; `review.service.ts` was the ninth. The joint upload made forgetting
      it worse: that path puts an agreement in force from a single staff request, so an unscoped
      reach stopped meaning "acts on the wrong contract" and started meaning "manufactures a
      signature". Found by the security session, with a reproduction rather than a theory.

      The predicate goes in the query below and NOT as a comment inside it — a backtick inside a
      sql template literal ends the template, which is how this line first failed to compile.
    */
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
      history: ContractHistoryEntry[];
    }>(sql`
      SELECT c.id,
             p.reference    AS partner_reference,
             p.display_name AS partner_name,
             c.kind::text   AS kind,
             c.status::text AS status,
             c.file_name, c.size_bytes,
             ${actorName(sql`u.email`, sql`u.role`)} AS uploaded_by,
             to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS uploaded_at,
             to_char(c.signed_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS signed_at,
             to_char(c.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS expires_at,
             CASE WHEN c.expires_at IS NULL THEN NULL
                  ELSE floor(extract(epoch FROM (c.expires_at - now())) / 86400)::int
             END AS days_to_expiry,
             ${contractHistorySelect}
      FROM partner_contracts c
      JOIN partners p     ON p.id = c.partner_id
      LEFT JOIN users u   ON u.id = c.uploaded_by_user_id
      ${contractHistoryJoin}
      WHERE c.deleted_at IS NULL ${filter}
        AND ${scopeFilter(actor, 'p.city_id')}
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
      history: row.history,
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
      city_id: string;
      email: string;
      locale: string;
    }>(sql`
      SELECT p.id, p.display_name, p.city_id, u.email, u.preferred_locale AS locale
      FROM partners p
      JOIN users u ON u.id = p.user_id
      WHERE p.reference = ${input.partnerReference} AND p.deleted_at IS NULL
      LIMIT 1
    `);

    const partnerRow = partner.rows[0];
    const partnerId = partnerRow?.id;

    /*
      Staff scope, on the WRITE (2026-08-23).

      `scopeFilter` governs lists only, and under `outside: 'read_only'` it deliberately returns
      TRUE — so a read predicate alone leaves a read-only-scoped member able to change a contract
      anywhere in the country. The row is fetched, then refused: 404 when the scope is `none`
      («not yours» answers as «not there»), and a coded 403 under `read_only`, which is the mode
      saying "look, do not touch".
    */
    if (partnerRow) assertCanWrite(actor, partnerRow.city_id);

    if (!partnerRow || !partnerId) throw notFound(ERROR.PARTNER_NOT_FOUND);

    /*
      The object key is derived from ids, never from the uploaded filename. A filename is
      attacker-controlled and reaches a storage path — `../../` traversal, or a name that
      collides with another partner's file.
    */
    const key = `partner-contracts/${partnerId}/${Date.now()}-${randomUUID()}-${input.kind}.pdf`;

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

    return this.list(actor, input.partnerReference);
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
      city_id: string;
    }>(sql`
      SELECT c.id, c.status::text AS status, c.kind::text AS kind,
             c.partner_id, p.reference AS partner_reference, p.city_id
      FROM partner_contracts c
      JOIN partners p ON p.id = c.partner_id
      WHERE c.id = ${id}::uuid AND c.deleted_at IS NULL AND p.deleted_at IS NULL
      LIMIT 1
    `);

    const contract = found.rows[0];

    if (!contract) throw notFound(ERROR.CONTRACT_NOT_FOUND);

    /* Staff scope on the write — see `upload`. */
    assertCanWrite(actor, contract.city_id);

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

    return this.list(actor, contract.partner_reference);
  }

  /**
   * Generates the partnership agreement from the template and stores it as a `draft`.
   *
   * ## The terms come from SETTINGS, not from the template
   *
   * Commission, the customer fee and the notice period are read live and interpolated. A contract
   * stating a rate the platform does not charge is worse than no contract, and the surest way to
   * produce one is to write the number in the document.
   *
   * ## The hash is taken here, once
   *
   * Everything downstream depends on it: both signatures record it, and signing refuses if the
   * stored file no longer matches. Taken from the exact bytes that go to storage, so there is no
   * window in which the hash describes something other than what was saved.
   *
   * ## Supersedes, exactly as `upload` does
   *
   * Same reasoning and the same statement: generating a replacement puts the previous one out of
   * play whether or not anyone had signed it, or the partial unique index would have to arbitrate
   * between two contracts of the same kind.
   */
  async generate(
    actor: AccessTokenClaims | undefined,
    partnerReference: string,
    kind: string,
  ): Promise<ContractRow[]> {
    const partner = await this.db.execute<{
      id: string;
      reference: string;
      legal_name: string;
      display_name: string;
      address: string;
      city_id: string;
    }>(sql`
      SELECT p.id, p.reference, p.legal_name, p.display_name, p.address, p.city_id
      FROM partners p
      WHERE p.reference = ${partnerReference} AND p.deleted_at IS NULL
      LIMIT 1
    `);

    const row = partner.rows[0];

    /* Staff scope on the write — see `upload`. A read predicate alone leaves `read_only` able to write. */
    if (row) assertCanWrite(actor, row.city_id);

    if (!row) throw notFound(ERROR.PARTNER_NOT_FOUND);

    const [rate, fee, notice] = await Promise.all([
      this.settings.getNumber('commission.partner_rate', 0.07),
      this.settings.getNumber('commission.customer_fee_value', 1.99),
      this.settings.getNumber('contract.notice_days', 30),
    ]);

    /*
      The issue date is passed IN rather than read inside the template, so the document stays a
      pure function of its inputs. Nothing in `renderContractHtml` calls the clock — two renders
      of the same contract must produce the same bytes, or the hash both parties sign means
      nothing.
    */
    const issuedOn = new Date().toISOString().slice(0, 10);

    const html = renderContractHtml({
      partnerReference: row.reference,
      partnerLegalName: row.legal_name,
      partnerDisplayName: row.display_name,
      partnerAddress: row.address,
      issuedOn,
      commissionPercent: Math.round(rate * 1000) / 10,
      customerFee: `$${fee.toFixed(2)}`,
      noticeDays: notice,
    });

    const bytes = await renderContractPdf(html);
    const documentHash = createHash('sha256').update(bytes).digest('hex');
    const key = `partner-contracts/${row.id}/${Date.now()}-${randomUUID()}-${kind}.pdf`;
    const fileName = `${row.reference}-${kind}.pdf`;

    await this.storage.put(key, bytes, 'application/pdf');

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE partner_contracts
        SET status = 'superseded'
        WHERE partner_id = ${row.id}::uuid
          AND kind = ${kind}::partner_contract_kind
          AND status IN ('draft', 'active', 'awaiting_partner_signature')
          AND deleted_at IS NULL
      `);

      const inserted = await tx.execute<{ id: string }>(sql`
        INSERT INTO partner_contracts
          (partner_id, kind, status, file_key, file_name, content_type, size_bytes,
           uploaded_by_user_id, document_hash)
        VALUES (${row.id}::uuid, ${kind}::partner_contract_kind, 'draft', ${key}, ${fileName},
                'application/pdf', ${bytes.byteLength}, ${actor?.sub}::uuid, ${documentHash})
        RETURNING id
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'partner_contract.generated',
          subjectType: 'partner_contract',
          subjectId: inserted.rows[0]?.id ?? null,
          /* The HASH, never the document. An audit row is not a place to keep a copy. */
          after: { kind, documentHash, sizeBytes: bytes.byteLength },
        },
        tx as unknown as Database,
      );
    });

    return this.list(actor, row.reference);
  }

  /**
   * The contract file, for staff (Bashar, 2026-08-21).
   *
   * Needed because signing is on paper: a staff member cannot sign a document they cannot get
   * hold of. The card on الشركاء used to say «عرض» was unimplemented, and that was defensible
   * while the file was only ever an upload somebody already had; it stops being defensible the
   * moment the platform is the thing that produced it.
   *
   * `party` selects WHICH file: the generated original, or either side's signed scan. Validated
   * against a closed set rather than taken as a key — a caller naming an object path is how one
   * partner reads another's contract.
   */
  async readFile(
    actor: AccessTokenClaims | undefined,
    id: string,
    party: 'original' | 'safra' | 'partner',
  ): Promise<{ body: Buffer; fileName: string }> {
    const owner = await this.db.execute<{
      city_id: string;
      partner_deleted: boolean;
    }>(sql`
      SELECT p.city_id, p.deleted_at IS NOT NULL AS partner_deleted
      FROM partner_contracts c
      JOIN partners p ON p.id = c.partner_id
      WHERE c.id = ${id}::uuid AND c.deleted_at IS NULL
      LIMIT 1
    `);

    /*
      ABSENCE IS A REFUSAL, not a pass.

      This read `if (owner.rows[0]) assertCanRead(...)` for about twenty minutes, and that shape is
      a scope bypass: the lookup filters `p.deleted_at IS NULL`, so soft-deleting a partner made the
      row vanish, the guard was SKIPPED rather than failed, and the file lookup below — which joins
      no partners at all — returned the bytes. A city-scoped member with no outside access could
      download any soft-deleted partner's contract. Deny-by-default inverted into allow-by-default
      by a missing row.

      The same `if (row)` idiom in `upload` and `generate` is safe only because the very next line
      throws on the falsy case. It is worth not leaving that pattern around where nothing catches
      the null, which is precisely what happened here.
    */
    const partner = owner.rows[0];

    if (!partner) throw notFound(ERROR.CONTRACT_NOT_FOUND);

    /*
      SCOPE FIRST, existence second — and the lookup above deliberately does NOT filter
      `p.deleted_at`. `assertCanRead` rather than `assertCanWrite`, because `read_only` means "look
      at the rest of the country, do not change it" and the write guard would break that mode.

      The first version of this guard did filter it, and read `if (owner.rows[0]) assertCanRead(…)`.
      Soft-deleting a partner then made the row vanish, so the guard was SKIPPED rather than failed
      and the file came back: a city-scoped member with no outside access could download any
      soft-deleted partner's contract. Deny-by-default inverted by a missing row.

      Fetching the city regardless of deletion means the scope question is always asked and always
      answerable. Deletion is then refused on its own line, AFTER the scope has been honoured — so
      an out-of-scope caller learns nothing about whether the partner still exists, and an in-scope
      caller still cannot read a removed partner's file.
    */
    assertCanRead(actor, partner.city_id);

    if (partner.partner_deleted) throw notFound(ERROR.CONTRACT_NOT_FOUND);
    const found =
      party === 'original'
        ? await this.db.execute<{ file_key: string; file_name: string }>(sql`
            SELECT file_key, file_name FROM partner_contracts
            WHERE id = ${id}::uuid AND deleted_at IS NULL LIMIT 1
          `)
        : await this.db.execute<{ file_key: string; file_name: string }>(sql`
            SELECT s.file_key, s.file_name
            FROM partner_contract_signatures s
            JOIN partner_contracts c ON c.id = s.contract_id AND c.deleted_at IS NULL
            WHERE s.contract_id = ${id}::uuid
              AND s.party = ${party}::contract_signature_party
            LIMIT 1
          `);

    const row = found.rows[0];

    if (!row) throw notFound(ERROR.CONTRACT_NOT_FOUND);

    const body = await this.storage.get(row.file_key);

    if (!body) throw notFound(ERROR.CONTRACT_NOT_FOUND);

    await this.audit.record({
      actorUserId: actor?.sub,
      actorRole: actor?.role,
      action: 'partner_contract.viewed',
      subjectType: 'partner_contract',
      subjectId: id,
      after: { party },
    });

    return { body, fileName: row.file_name };
  }

  /**
   * Tells the partner their contract is waiting, after SAFRA has signed it.
   *
   * `users.email` rather than `partners.email`: the account is what receives platform mail, and
   * the two can differ. Failure is logged and swallowed by the caller — a contract that is signed
   * and stored is signed and stored whether or not an SMTP server was reachable, and the partner
   * finds it on their own screen regardless.
   */
  private async notifyPartnerContractSent(partnerReference: string): Promise<void> {
    const rows = await this.db.execute<{ email: string; locale: string }>(sql`
      SELECT u.email, u.preferred_locale AS locale
      FROM partners p JOIN users u ON u.id = p.user_id
      WHERE p.reference = ${partnerReference} AND p.deleted_at IS NULL
      LIMIT 1
    `);

    const partner = rows.rows[0];

    if (!partner) return;

    await this.mail.send(
      partnerContractAwaitingSignatureMail({
        to: partner.email,
        reference: partnerReference,
        url: new URL('/contracts', this.env.PARTNER_URL).toString(),
        locale: partner.locale,
      }),
    );

    this.logger.log(`Told ${partnerReference} their contract is ready to sign.`);
  }

  /**
   * Sends the partner their COUNTERSIGNED contract (Bashar, 2026-08-23).
   *
   * The two-step flow never needed this: the partner made the contract `active` themselves, from
   * their own account, so they already knew and already held the file. A joint upload is the first
   * path where a contract becomes binding without the partner touching the platform at all — they
   * signed on paper and walked out — so without this the only record they hold is the sheet in
   * their hand.
   *
   * Deliberately NOT `partnerContractAwaitingSignatureMail`: that one asks them to sign, and the
   * API would refuse them if they tried, which is the worst kind of instruction to send somebody.
   */
  private async notifyPartnerContractCountersigned(
    partnerReference: string,
  ): Promise<void> {
    const rows = await this.db.execute<{ email: string; locale: string }>(sql`
      SELECT u.email, u.preferred_locale AS locale
      FROM partners p JOIN users u ON u.id = p.user_id
      WHERE p.reference = ${partnerReference} AND p.deleted_at IS NULL
      LIMIT 1
    `);

    const partner = rows.rows[0];

    if (!partner) return;

    await this.mail.send(
      partnerContractCountersignedMail({
        to: partner.email,
        reference: partnerReference,
        url: new URL('/contracts', this.env.PARTNER_URL).toString(),
        locale: partner.locale,
      }),
    );

    this.logger.log(`Sent ${partnerReference} their countersigned contract.`);
  }

  /**
   * Tells the super admins that a partner has returned a signed contract.
   *
   * Every active `super_admin`, the same recipients and reasoning as the documents notification:
   * not a configured address, which goes stale when somebody leaves, and not every reviewer role,
   * because a mailbox full of other people's queues is one nobody reads.
   */
  private async notifyStaffContractReturned(partnerReference: string): Promise<void> {
    const partner = await this.db.execute<{ display_name: string }>(sql`
      SELECT display_name FROM partners
      WHERE reference = ${partnerReference} AND deleted_at IS NULL LIMIT 1
    `);

    const displayName = partner.rows[0]?.display_name;

    if (!displayName) return;

    const staff = await this.db.execute<{ email: string; locale: string }>(sql`
      SELECT email, preferred_locale AS locale FROM users
      WHERE role = 'super_admin' AND status = 'active' AND deleted_at IS NULL
    `);

    if (staff.rows.length === 0) {
      this.logger.warn(
        `${partnerReference} returned a signed contract and no active super admin exists to tell.`,
      );

      return;
    }

    const url = new URL(`/partners/${partnerReference}`, this.env.ADMIN_URL).toString();

    await Promise.all(
      staff.rows.map((recipient) =>
        this.mail.send(
          partnerContractReturnedMail({
            to: recipient.email,
            reference: partnerReference,
            displayName,
            url,
            locale: recipient.locale,
          }),
        ),
      ),
    );

    /* The COUNT of recipients, never their addresses. */
    this.logger.log(
      `Notified ${staff.rows.length} super admin(s) that ${partnerReference} returned their contract.`,
    );
  }

  /**
   * One party's HAND-SIGNED copy, uploaded (Bashar, 2026-08-21).
   *
   * ## Why this is an upload and not a click
   *
   * The first version of this was a typed-name electronic signature. **Bashar stopped it:
   * electronic signatures are not accepted in Syria**, which is where the partners are. So the
   * platform carries what the parties actually do — print, sign, scan, send — and its job is to
   * order the steps, hold the files and record what happened.
   *
   * ## What is verified before an upload is accepted
   *
   * In order, and each refusal is its own answer:
   *
   * 1. The contract exists, and belongs to the partner the caller is entitled to act for.
   * 2. Its status is the one that party is expected to act on — `draft` for SAFRA,
   *    `awaiting_partner_signature` for the partner. **This is what enforces the order**: a
   *    partner cannot return a signed copy of a contract SAFRA has not signed, because it is not
   *    in a state they can reach.
   * 3. The bytes are a PDF, by their leading signature and not by what the request claims.
   *
   * ## What is deliberately NOT verified
   *
   * That the scan resembles the document sent out. It cannot be: the file went through a printer,
   * a pen and a scanner, so nothing about its bytes relates to the original. What is recorded
   * instead is `original_hash` — which generated version was current when this came back — so a
   * partner who signed a superseded revision is a discrepancy the record shows rather than hides.
   *
   * The unique index on `(contract_id, party)` makes a retried upload safe: the status check has
   * already moved on by then, and the constraint catches the race the check cannot see.
   */
  private async recordSignedCopy(input: {
    actor: AccessTokenClaims | undefined;
    contractId: string;
    party: 'safra' | 'partner';
    content: string;
    fileName: string;
    context: { ipAddress?: string | undefined; userAgent?: string | undefined };
    /** Set for a partner uploading: the contract must be theirs and nobody else's. */
    restrictToPartnerId?: string | undefined;
  }): Promise<{ partnerReference: string; contractId: string }> {
    const bytes = Buffer.from(input.content, 'base64');

    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      throw badRequest(ERROR.CONTRACT_PDF_REQUIRED);
    }

    /* Magic bytes, not the declared type — the same check `upload` makes, for the same reason. */
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw badRequest(ERROR.CONTRACT_PDF_REQUIRED);
    }

    /*
      Which states each party may upload in (Bashar, 2026-08-21, extended 2026-08-23).

      SAFRA may upload MORE THAN ONCE. Their first version can be the wrong page, the wrong
      contract or an unreadable scan, and until now the only remedy was to regenerate the whole
      document — which threw the terms away to correct a photograph. So `safra` is allowed in every
      live state, and each upload supersedes the last.

      The partner is still allowed only when it is their turn. Their step is handed back
      deliberately, by `reopenForPartner`, because a party that can re-sign at will has not signed
      anything — and unlike SAFRA, the partner is not the one who can see whether the document is
      right.
    */
    const allowed =
      input.party === 'safra'
        ? ['draft', 'awaiting_partner_signature', 'active']
        : ['awaiting_partner_signature'];

    const found = await this.db.execute<{
      id: string;
      status: string;
      partner_id: string;
      partner_reference: string;
      city_id: string;
      document_hash: string | null;
    }>(sql`
      SELECT c.id, c.status::text AS status, c.partner_id, c.document_hash,
             p.reference AS partner_reference, p.city_id
      FROM partner_contracts c
      JOIN partners p ON p.id = c.partner_id
      WHERE c.id = ${input.contractId}::uuid AND c.deleted_at IS NULL
        AND p.deleted_at IS NULL
      LIMIT 1
    `);

    const contract = found.rows[0];

    /*
      "Not yours" answers the same as "not there". A partner probing contract ids must not be able
      to tell another partner's contract from one that does not exist.
    */
    if (
      !contract ||
      (input.restrictToPartnerId && contract.partner_id !== input.restrictToPartnerId)
    ) {
      throw notFound(ERROR.CONTRACT_NOT_FOUND);
    }

    /*
      Staff scope, on the SAFRA side only.

      `restrictToPartnerId` is set exactly when a PARTNER is uploading their own copy, and a partner
      has no `scope` claim — `scopeOf` would return UNSCOPED and the guard would be a no-op. Gating
      on its absence keeps that true by construction rather than by accident, and stops this line
      reading as though a partner could be city-scoped.
    */
    if (input.restrictToPartnerId === undefined) {
      assertCanWrite(input.actor, contract.city_id);
    }

    if (!allowed.includes(contract.status)) throw conflict(ERROR.CONTRACT_NOT_SIGNABLE);

    const fileHash = createHash('sha256').update(bytes).digest('hex');

    /*
      A uuid in the key, not just the millisecond.

      Now that this upload REPEATS, two of them landing in the same millisecond would write the
      same key twice — and the second write would replace the bytes the first signature row still
      points at. A superseded row exists precisely to be the evidence of what was sent; silently
      swapping the file under it is the one failure that record cannot survive, and it leaves no
      trace because both rows still look right.
    */
    const key =
      `partner-contracts/${contract.partner_id}/` +
      `signed-${input.party}-${Date.now()}-${randomUUID()}.pdf`;

    await this.storage.put(key, bytes, 'application/pdf');

    const nextStatus = input.party === 'safra' ? 'awaiting_partner_signature' : 'active';

    /*
      Whether this upload took a partner's signature down with it — the fact a later reader of the
      audit log actually needs. The status change alone does not say it: `active` →
      `awaiting_partner_signature` reads the same whether the partner had signed and was undone or
      the state was simply being corrected, and "was this signature invalidated, when, and by whom"
      is the question asked when a contract is disputed.
    */
    let invalidatedPartnerSignature = false;

    await this.db.transaction(async (tx) => {
      /*
        Serialise concurrent uploads on THIS contract (2026-08-23).

        Two requests — a double-click is enough — both superseded the live rows before either
        inserted, because under READ COMMITTED neither sees the other's uninserted work. Both then
        inserted, and the partial unique index on (contract_id, party) WHERE superseded_at IS NULL
        rejected the second with a raw constraint violation: a 500, and an object already written
        to storage that nothing references.

        The row lock makes the second wait, re-read, and supersede what the first actually wrote.
        It costs nothing on the uncontended path, which is every real one.
      */
      await tx.execute(sql`
        SELECT id FROM partner_contracts WHERE id = ${contract.id}::uuid FOR UPDATE
      `);

      /*
        Whatever this party sent before stops being the live copy. Superseded, never deleted — the
        earlier attempt is the record that it was sent, and the partial unique index counts only
        live rows, so this is what makes a second upload possible at all.
      */
      await tx.execute(sql`
        UPDATE partner_contract_signatures
        SET superseded_at = now()
        WHERE contract_id = ${contract.id}::uuid
          AND party = ${input.party}::contract_signature_party
          AND superseded_at IS NULL
      `);

      /*
        And when SAFRA replaces THEIR copy, the partner's signature goes with it.

        The partner signed a specific document. Once SAFRA sends a different one, that signature is
        on a page that is no longer the contract — leaving it live would show a countersigned
        agreement whose two signatures are on two different papers, which is the one thing this
        whole record exists to prevent.
      */
      if (input.party === 'safra') {
        /*
          `RETURNING id` rather than a row count: a driver's `rowCount` does not survive every
          wrapper this runs behind, and it silently reads as zero when it does not — which would
          quietly drop the fact from the audit row instead of failing.
        */
        const dropped = await tx.execute<{ id: string }>(sql`
          UPDATE partner_contract_signatures
          SET superseded_at = now()
          WHERE contract_id = ${contract.id}::uuid
            AND party = 'partner'
            AND superseded_at IS NULL
          RETURNING id
        `);

        invalidatedPartnerSignature = dropped.rows.length > 0;
      }

      await tx.execute(sql`
        INSERT INTO partner_contract_signatures
          (contract_id, party, uploaded_by_user_id, file_key, file_name, size_bytes,
           file_hash, original_hash, ip_address, user_agent)
        VALUES (${contract.id}::uuid, ${input.party}::contract_signature_party,
                ${input.actor?.sub}::uuid, ${key}, ${safeContractFileName(input.fileName)},
                ${bytes.byteLength}, ${fileHash}, ${contract.document_hash},
                ${input.context.ipAddress ?? null}, ${input.context.userAgent ?? null})
      `);

      /*
        `signed_at` means "both sides are bound", so a fresh SAFRA copy clears it: the contract is
        waiting for the partner again, and a date left behind would read as binding on a screen
        that is asking somebody to sign.
      */
      await tx.execute(sql`
        UPDATE partner_contracts
        SET status = ${nextStatus}::partner_contract_status,
            ${
              input.party === 'safra'
                ? sql`sent_at = now(), signed_at = NULL,`
                : sql`signed_at = now(),`
            }
            updated_at = now()
        WHERE id = ${contract.id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: input.actor?.sub,
          actorRole: input.actor?.role,
          action: 'partner_contract.countersigned',
          subjectType: 'partner_contract',
          subjectId: contract.id,
          before: { status: contract.status },
          /* Hashes and sizes. An audit row is not a place to keep a copy of a signed contract. */
          after: {
            status: nextStatus,
            party: input.party,
            fileHash,
            sizeBytes: bytes.byteLength,
            ...(invalidatedPartnerSignature ? { invalidatedPartnerSignature: true } : {}),
          },
        },
        tx as unknown as Database,
      );
    });

    return { partnerReference: contract.partner_reference, contractId: contract.id };
  }

  /**
   * Hands the signing step back to the partner (Bashar, 2026-08-21).
   *
   * ## Why this exists
   *
   * A partner who uploads the wrong scan — the unsigned page, the wrong contract, a photograph of
   * their thumb — has no way back on their own. The state machine refuses a second upload, and it
   * is right to: one party signs once, and a step anybody can redo at will is not a signature.
   * But the two of them will notice, they will speak, and then somebody has to be able to say
   * "send it again". Before this, the only route was to regenerate the whole contract, which threw
   * away SAFRA's signature as well and made both sides start over for one side's mistake.
   *
   * ## The first attempt is superseded, never deleted
   *
   * `superseded_at` on the signature row, and a partial unique index that only counts live ones.
   * The wrong scan stays exactly where it was, with who uploaded it and when — a signature record
   * that can be made to disappear is not evidence, and "they sent the wrong thing twice" is
   * precisely the history somebody may later need.
   *
   * ## Only from `active`
   *
   * There is nothing to hand back before that: in `draft` it is SAFRA's turn, and in
   * `awaiting_partner_signature` the partner can already upload. Re-opening a contract that has
   * been superseded or terminated would revive a document that is out of play.
   */
  async reopenForPartner(
    actor: AccessTokenClaims | undefined,
    contractId: string,
  ): Promise<ContractRow[]> {
    const found = await this.db.execute<{
      id: string;
      status: string;
      partner_reference: string;
      city_id: string;
    }>(sql`
      SELECT c.id, c.status::text AS status, p.reference AS partner_reference, p.city_id
      FROM partner_contracts c
      JOIN partners p ON p.id = c.partner_id
      WHERE c.id = ${contractId}::uuid AND c.deleted_at IS NULL AND p.deleted_at IS NULL
      LIMIT 1
    `);

    const contract = found.rows[0];

    if (!contract) throw notFound(ERROR.CONTRACT_NOT_FOUND);

    /* Staff scope on the write — see `upload`. */
    assertCanWrite(actor, contract.city_id);
    if (contract.status !== 'active') throw conflict(ERROR.CONTRACT_NOT_REOPENABLE);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE partner_contract_signatures
        SET superseded_at = now()
        WHERE contract_id = ${contract.id}::uuid
          AND party = 'partner'
          AND superseded_at IS NULL
      `);

      /*
        `signed_at` goes back to NULL with it. It means "both sides are bound", and after this the
        partner's side is open again — leaving the date behind would make the contract read as
        binding on a screen that is asking somebody to sign it.
      */
      await tx.execute(sql`
        UPDATE partner_contracts
        SET status = 'awaiting_partner_signature', signed_at = NULL, updated_at = now()
        WHERE id = ${contract.id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'partner_contract.reopened',
          subjectType: 'partner_contract',
          subjectId: contract.id,
          before: { status: contract.status },
          after: { status: 'awaiting_partner_signature', party: 'partner' },
        },
        tx as unknown as Database,
      );
    });

    /* Told, for the same reason the first send is: a step nobody mentions is a step nobody takes. */
    await this.notifyPartnerContractSent(contract.partner_reference).catch(
      (error: unknown) => {
        this.logger.error(
          `Could not tell ${contract.partner_reference} their contract was re-opened: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );

    return this.list(actor, contract.partner_reference);
  }

  /**
   * SAFRA's signed copy, which is what sends the contract to the partner.
   *
   * The partner is emailed after the transaction commits — see `notifyPartnerContractSent`. Mail
   * failure never rolls the upload back: the contract is signed and stored either way, and a
   * partner who was not emailed still finds it on their own screen.
   */
  async uploadSafraSignedCopy(
    actor: AccessTokenClaims | undefined,
    contractId: string,
    input: { content: string; fileName: string },
    context: { ipAddress?: string | undefined; userAgent?: string | undefined },
  ): Promise<ContractRow[]> {
    const { partnerReference } = await this.recordSignedCopy({
      actor,
      contractId,
      party: 'safra',
      content: input.content,
      fileName: input.fileName,
      context,
    });

    await this.notifyPartnerContractSent(partnerReference).catch((error: unknown) => {
      this.logger.error(
        `Could not tell ${partnerReference} their contract is ready: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    });

    return this.list(actor, partnerReference);
  }

  /**
   * ONE scan carrying BOTH signatures, filed by staff (Bashar, 2026-08-23).
   *
   * ## The case
   *
   * The super admin and the partner are at the same table. They print the contract, both sign the
   * same sheet, and it is scanned once. There is no send and no return trip — the two-step flow
   * describes a journey neither of them is making, and before this the operator had to pretend to
   * make it: upload as SAFRA, then have the partner sign in from an account whose password they
   * had not set yet, which is a wall rather than a step.
   *
   * ## Only while the partner is still being ADDED
   *
   * Bashar's constraint, and it is enforced here rather than by hiding a button: refused once the
   * partner is `approved`. "Adding a new partner" is precisely the window before verification
   * completes; afterwards they are a live counterparty and a change to their contract goes through
   * the ordinary two-step flow, where each side signs from their own account and the record says so.
   *
   * A hidden control is not an authorization decision. Without this check the route would be
   * callable by any staff account holding the contract permission, against any partner on the
   * platform, and would write a `partner` signature row for somebody who never signed anything.
   *
   * ## Two rows, one file
   *
   * Both signatures are on one page, so both rows carry the same `file_key` and the same
   * `file_hash`. That is the honest record: two signatures, one document. Writing one row would
   * lose the fact that the partner signed at all, and the partner-facing download resolves through
   * `party = 'partner'` — so a single `safra` row would leave the partner unable to fetch the very
   * document they signed.
   *
   * ## `party = 'partner'` written by a staff account
   *
   * Deliberate, and the schema's docblock was corrected in the same change to stop claiming
   * otherwise. `contract_signature_party` answers "whose signature is on this paper" — and the
   * partner's ink genuinely is. "Who put the file there" is a different question, and
   * `uploaded_by_user_id` already answers it. A third enum value would encode in one column what
   * two columns already say, at the cost of a migration and a new case in every reader.
   */
  async uploadJointSignedCopy(
    actor: AccessTokenClaims | undefined,
    contractId: string,
    input: { content: string; fileName: string },
    context: { ipAddress?: string | undefined; userAgent?: string | undefined },
  ): Promise<ContractRow[]> {
    const bytes = Buffer.from(input.content, 'base64');

    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      throw badRequest(ERROR.CONTRACT_PDF_REQUIRED);
    }

    /* Magic bytes, not the declared type — the same check every other upload here makes. */
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw badRequest(ERROR.CONTRACT_PDF_REQUIRED);
    }

    const found = await this.db.execute<{
      id: string;
      status: string;
      partner_id: string;
      partner_reference: string;
      verification: string;
      city_id: string;
      document_hash: string | null;
    }>(sql`
      SELECT c.id, c.status::text AS status, c.partner_id, c.document_hash,
             p.reference AS partner_reference, p.verification::text AS verification,
             p.city_id
      FROM partner_contracts c
      JOIN partners p ON p.id = c.partner_id
      WHERE c.id = ${contractId}::uuid AND c.deleted_at IS NULL
        AND p.deleted_at IS NULL
      LIMIT 1
    `);

    const contract = found.rows[0];

    if (!contract) throw notFound(ERROR.CONTRACT_NOT_FOUND);

    /*
      The onboarding-only boundary, from the predicate the CONSOLE also reads — so the button is
      absent in exactly the cases this refuses. See `canFileJointContract` for why the rule is
      "still being added" rather than "not approved": a rejected partner is excluded too, and
      writing `!== 'approved'` here would have filed a signed agreement for somebody the platform
      turned down.
    */
    /* Staff scope before anything else about the contract — see `upload`. */
    assertCanWrite(actor, contract.city_id);

    if (!canFileJointContract(contract.verification)) {
      throw conflict(ERROR.CONTRACT_JOINT_NOT_ALLOWED);
    }

    /*
      Every live state. The operator may have generated it days ago and even sent it, and then the
      partner walked in — in which case the sheet on the table supersedes whatever was in flight.
    */
    if (!['draft', 'awaiting_partner_signature', 'active'].includes(contract.status)) {
      throw conflict(ERROR.CONTRACT_NOT_SIGNABLE);
    }

    const fileHash = createHash('sha256').update(bytes).digest('hex');

    /* A uuid, not just the millisecond — see `recordSignedCopy` for what a collision destroys. */
    const key =
      `partner-contracts/${contract.partner_id}/` +
      `signed-joint-${Date.now()}-${randomUUID()}.pdf`;

    await this.storage.put(key, bytes, 'application/pdf');

    await this.db.transaction(async (tx) => {
      /*
        Serialise concurrent uploads on THIS contract (2026-08-23).

        Two requests — a double-click is enough — both superseded the live rows before either
        inserted, because under READ COMMITTED neither sees the other's uninserted work. Both then
        inserted, and the partial unique index on (contract_id, party) WHERE superseded_at IS NULL
        rejected the second with a raw constraint violation: a 500, and an object already written
        to storage that nothing references.

        The row lock makes the second wait, re-read, and supersede what the first actually wrote.
        It costs nothing on the uncontended path, which is every real one.
      */
      await tx.execute(sql`
        SELECT id FROM partner_contracts WHERE id = ${contract.id}::uuid FOR UPDATE
      `);

      /* Whatever either side had on file stops being live. Superseded, never deleted. */
      await tx.execute(sql`
        UPDATE partner_contract_signatures
        SET superseded_at = now()
        WHERE contract_id = ${contract.id}::uuid AND superseded_at IS NULL
      `);

      /*
        Both rows point at the SAME object. `party` is the only thing that differs, which is what
        the partial unique index on (contract_id, party) WHERE superseded_at IS NULL expects.
      */
      for (const party of ['safra', 'partner'] as const) {
        await tx.execute(sql`
          INSERT INTO partner_contract_signatures
            (contract_id, party, uploaded_by_user_id, file_key, file_name, size_bytes,
             file_hash, original_hash, ip_address, user_agent)
          VALUES (${contract.id}::uuid, ${party}::contract_signature_party,
                  ${actor?.sub}::uuid, ${key}, ${safeContractFileName(input.fileName)},
                  ${bytes.byteLength}, ${fileHash}, ${contract.document_hash},
                  ${context.ipAddress ?? null}, ${context.userAgent ?? null})
        `);
      }

      /*
        Straight to `active`, with both dates set. It was never "sent" in the postal sense, but
        `sent_at` means "the partner has had this document" and they have — they signed it.
      */
      await tx.execute(sql`
        UPDATE partner_contracts
        SET status = 'active'::partner_contract_status,
            sent_at = now(), signed_at = now(), updated_at = now()
        WHERE id = ${contract.id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'partner_contract.countersigned',
          subjectType: 'partner_contract',
          subjectId: contract.id,
          before: { status: contract.status },
          /*
            `joint` is the fact that separates this row from an ordinary countersignature: one
            document, both parties, filed by staff. Without it the log would show a partner
            signature uploaded by a staff account and no way to tell that from a mistake.
          */
          after: {
            status: 'active',
            party: 'joint',
            joint: true,
            fileHash,
            sizeBytes: bytes.byteLength,
          },
        },
        tx as unknown as Database,
      );
    });

    await this.notifyPartnerContractCountersigned(contract.partner_reference).catch(
      (error: unknown) => {
        this.logger.error(
          `Could not send ${contract.partner_reference} their countersigned contract: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );

    return this.list(actor, contract.partner_reference);
  }

  /**
   * The partner's counter-signed copy, which makes the contract binding.
   *
   * `partnerId` comes from the caller's token and is never taken from the request — which makes
   * "return a signed copy of somebody else's contract" unexpressible rather than merely refused.
   */
  async uploadPartnerSignedCopy(
    actor: AccessTokenClaims | undefined,
    partnerId: string,
    contractId: string,
    input: { content: string; fileName: string },
    context: { ipAddress?: string | undefined; userAgent?: string | undefined },
  ): Promise<void> {
    const { partnerReference } = await this.recordSignedCopy({
      actor,
      contractId,
      party: 'partner',
      content: input.content,
      fileName: input.fileName,
      context,
      restrictToPartnerId: partnerId,
    });

    await this.notifyStaffContractReturned(partnerReference).catch((error: unknown) => {
      this.logger.error(
        `Could not tell staff that ${partnerReference} returned their contract: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}

/**
 * A safe name for an uploaded scan.
 *
 * The same reasoning as `safeFileName` in the documents service: a filename is caller-controlled
 * and ends up in a `Content-Disposition` header, where a newline would let it inject a header line.
 * Path separators go too — this value never builds a key, but a future reader should not have to
 * verify that before using it.
 */
function safeContractFileName(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();

  return (cleaned.length > 0 ? cleaned : 'signed-contract.pdf').slice(0, 120);
}
