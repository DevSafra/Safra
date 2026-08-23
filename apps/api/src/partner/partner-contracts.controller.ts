import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';

import type { Database } from '@safra/db';
import { ERROR, PERMISSIONS as P } from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { AuditService } from '../common/audit/audit.service.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import { DATABASE } from '../database/database.module.js';
import { StorageService } from '../storage/storage.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import {
  contractHistoryJoin,
  contractHistorySelect,
  PartnerContractService,
  signedCopySchema,
  type ContractHistoryEntry,
  type SignedCopyInput,
} from '../admin/partner-contract.service.js';
import { notFound } from '../common/errors/app-error.js';
import { requirePartnerId } from '../rbac/ownership.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * A partner reading the contract SAFRA sent them (Bashar, 2026-08-19, step 4).
 *
 * ## Why this is not the admin service with a different guard
 *
 * `PartnerContractService` answers "every contract, for staff": it lists across partners, it
 * uploads, it supersedes, it records a signature. None of that is a partner's to do — SAFRA drafts
 * the contract and SAFRA records that it came back signed — so the partner's side is a READ and
 * nothing else, and a read is all this exposes. A shared service with a `restrictToPartnerId`
 * parameter would put the write methods one forgotten argument away from a partner.
 *
 * ## The scoping is the WHERE clause
 *
 * `partner_id = <the id derived from the verified token>` is in both queries. There is no code
 * path here that takes a partner id from the request, so "show me another partner's contract" is
 * a question this controller cannot be asked. A contract that is not theirs answers 404, exactly
 * as one that does not exist — see the partner-documents read for the same reasoning.
 */
/*
  The partner sees EVERY contract, superseded ones included (Bashar, 2026-08-21).

  Hidden for a few hours and put back at his request. The argument for hiding them was that four
  «مُستبدل» rows with four download buttons invite signing the wrong paper; the argument for showing
  them is that they are the partner's own agreements and a portal that quietly drops records is
  worse than one that shows history. His call, and it is his platform.

  The status pill is what distinguishes them, and `ContractSigning` still renders an upload form
  only for `awaiting_partner_signature` — so a superseded row can be read and downloaded but not
  acted on, which is the property that made the reversal safe to make.
*/

@Injectable()
export class PartnerContractReadService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Their contracts, newest first, each carrying its own version history.
   *
   * Not paginated: a partner has a handful, ever.
   *
   * ## Why the history is here at all (Bashar, 2026-08-23)
   *
   * SAFRA can replace their signed copy on a contract that already exists, and when they replace
   * one the partner has SIGNED, that signature is superseded and the contract returns to the
   * partner's step. Without this the partner saw none of it: the same single card, silently back
   * to «بانتظار توقيعك», with no statement that anything had changed or that their own signature
   * no longer stood. A record that changes under somebody without telling them is the failure this
   * closes.
   *
   * ## What it deliberately does NOT carry
   *
   * Three columns per event, newest first — see `contractHistoryJoin`, which is the single
   * definition the console reads through too, so the two screens cannot drift on the ORDER or on
   * which columns leave the database.
   */
  async list(partnerId: string) {
    const rows = await this.db.execute<{
      id: string;
      kind: string;
      status: string;
      file_name: string;
      size_bytes: number;
      uploaded_at: string;
      signed_at: string | null;
      expires_at: string | null;
      history: ContractHistoryEntry[];
    }>(sql`
      SELECT c.id, c.kind::text AS kind, c.status::text AS status, c.file_name, c.size_bytes,
             c.created_at::text AS uploaded_at, c.signed_at::text, c.expires_at::text,
             ${contractHistorySelect}
      FROM partner_contracts c
      ${contractHistoryJoin}
      WHERE c.partner_id = ${partnerId}::uuid AND c.deleted_at IS NULL
      ORDER BY c.created_at DESC
    `);

    return rows.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      fileName: row.file_name,
      sizeBytes: row.size_bytes,
      uploadedAt: row.uploaded_at,
      signedAt: row.signed_at,
      expiresAt: row.expires_at,
      history: row.history,
    }));
  }

  async read(
    contractId: string,
    partnerId: string,
    actor: AccessTokenClaims | undefined,
  ): Promise<{ body: Buffer; fileName: string }> {
    /*
      The partner gets the SIGNED document, not the blank one (Bashar, 2026-08-21).

      This used to serve `partner_contracts.file_key` — the version SAFRA generated, before anybody
      touched it. A partner who downloaded that signed a sheet of paper with no SAFRA signature on
      it, and returned it: the result was two documents each carrying one signature, rather than one
      carrying both. Which is not a countersigned contract at all.

      So the newest signed copy wins, and the original is only the fallback:

      | Contract state | What comes back |
      | ------------------------------ | ----------------------------------- |
      | `awaiting_partner_signature` | SAFRA's hand-signed scan |
      | `active` | the partner's returned scan, carrying both |
      | anything else, or no scans yet | the generated original |

      Ordered by PARTY, not by time. The obvious `ORDER BY uploaded_at DESC` is wrong in a way a
      clock hides: `uploaded_at` defaults to `now()`, which inside one transaction is the
      transaction's start time — so two signatures written together tie, and the winner is
      whichever row the planner happens to return. In production the two uploads are minutes apart
      and it would have looked correct for as long as anybody cared to check.

      The rule does not need a clock anyway. The partner signs SAFRA's copy, so THEIR scan is the
      one carrying both signatures, by construction.

      A scan that staff superseded by re-opening the step is skipped: after a re-open the partner
      needs SAFRA's copy back, not the wrong one they just sent.

      A `draft` never reaches here: the portal shows «بانتظار توقيع سفرة» and offers no link, and
      the state machine refuses the partner's upload until SAFRA has signed.
    */
    const rows = await this.db.execute<{ file_key: string; file_name: string }>(sql`
      SELECT COALESCE(s.file_key, c.file_key) AS file_key,
             COALESCE(s.file_name, c.file_name) AS file_name
      FROM partner_contracts c
      LEFT JOIN LATERAL (
        SELECT file_key, file_name
        FROM partner_contract_signatures
        WHERE contract_id = c.id AND superseded_at IS NULL
        ORDER BY (party = 'partner') DESC, uploaded_at DESC
        LIMIT 1
      ) s ON TRUE
      WHERE c.id = ${contractId}::uuid
        AND c.partner_id = ${partnerId}::uuid
        AND c.deleted_at IS NULL
    `);

    const contract = rows.rows[0];

    /* Somebody else's contract and a contract that does not exist answer identically. */
    if (!contract) throw notFound(ERROR.CONTRACT_NOT_FOUND);

    const body = await this.storage.get(contract.file_key);

    if (!body) throw notFound(ERROR.CONTRACT_NOT_FOUND);

    await this.audit.record({
      actorUserId: actor?.sub,
      actorRole: actor?.role,
      action: 'partner_contract.viewed',
      subjectType: 'partner_contract',
      subjectId: contractId,
    });

    return { body, fileName: contract.file_name };
  }
}

@Controller('partner/contracts')
export class PartnerContractsController {
  constructor(
    private readonly contracts: PartnerContractReadService,
    /* The WRITE side lives with the staff service: one place owns the state machine. */
    private readonly signing: PartnerContractService,
  ) {}

  @Get()
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  async list(@CurrentUser() user: AccessTokenClaims | undefined) {
    const partnerId = requirePartnerId(user, P.PROPERTY_MANAGE_OWN);

    return { contracts: await this.contracts.list(partnerId) };
  }

  @Get(':contractId/file')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  @AuditExempt('PartnerContractReadService records partner_contract.viewed.')
  async download(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Res() response: Response,
  ) {
    const partnerId = requirePartnerId(user, P.PROPERTY_MANAGE_OWN);
    const contract = await this.contracts.read(contractId, partnerId, user);

    /*
      `attachment`, and a filename the SERVER chose from its own column.

      `inline` would render a partner's commercial agreement inside the dashboard's origin, and a
      PDF viewer is a scripting surface. `nosniff` because the content type is declared rather
      than detected — every row in this table is a PDF, checked by magic bytes at upload.
    */
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${contract.fileName.replace(/[^\w.-]/g, '_')}"`,
    );
    response.send(contract.body);
  }

  /**
   * The partner's hand-signed copy, coming back (Bashar, 2026-08-21).
   *
   * Electronic signatures are not accepted in Syria, so the partner downloads the PDF above, signs
   * it by hand, scans it and uploads it here. That upload makes the contract `active` and emails
   * the super admins.
   *
   * ## The partner id comes from the TOKEN
   *
   * `requirePartnerId` derives it from the verified claims, and the service refuses a contract
   * belonging to anyone else with a 404 rather than a 403. "Return a signed copy of somebody
   * else's contract" is not a request this endpoint can express.
   *
   * ## Not behind `RequireVerifiedPartner`
   *
   * Signing the contract is one of the steps that LEADS to verification — gating it on being
   * verified would be a deadlock. It sits alongside document upload for the same reason.
   */
  @Post(':contractId/signed-copy')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async uploadSignedCopy(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body(new ZodValidationPipe(signedCopySchema)) body: SignedCopyInput,
    @Req() request: { ip?: string; headers: Record<string, unknown> },
  ) {
    const partnerId = requirePartnerId(user, P.PROPERTY_MANAGE_OWN);

    await this.signing.uploadPartnerSignedCopy(user, partnerId, contractId, body, {
      ipAddress: request.ip,
      userAgent:
        typeof request.headers['user-agent'] === 'string'
          ? request.headers['user-agent']
          : undefined,
    });

    return { contracts: await this.contracts.list(partnerId) };
  }
}
