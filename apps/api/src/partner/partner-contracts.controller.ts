import {
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';

import type { Database } from '@safra/db';
import { ERROR, PERMISSIONS as P } from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { AuditService } from '../common/audit/audit.service.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import { DATABASE } from '../database/database.module.js';
import { StorageService } from '../storage/storage.service.js';
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
@Injectable()
export class PartnerContractReadService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** Their contracts, newest first. Not paginated: a partner has a handful, ever. */
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
    }>(sql`
      SELECT id, kind::text AS kind, status::text AS status, file_name, size_bytes,
             created_at::text AS uploaded_at, signed_at::text, expires_at::text
      FROM partner_contracts
      WHERE partner_id = ${partnerId}::uuid AND deleted_at IS NULL
      ORDER BY created_at DESC
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
    }));
  }

  async read(
    contractId: string,
    partnerId: string,
    actor: AccessTokenClaims | undefined,
  ): Promise<{ body: Buffer; fileName: string }> {
    const rows = await this.db.execute<{ file_key: string; file_name: string }>(sql`
      SELECT file_key, file_name FROM partner_contracts
      WHERE id = ${contractId}::uuid AND partner_id = ${partnerId}::uuid AND deleted_at IS NULL
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
  constructor(private readonly contracts: PartnerContractReadService) {}

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
}
