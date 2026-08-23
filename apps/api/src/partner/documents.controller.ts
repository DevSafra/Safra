import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import {
  PERMISSIONS as P,
  type PartnerDocumentReviewInput,
  type PartnerDocumentUploadInput,
  partnerDocumentReviewSchema,
  partnerDocumentUploadSchema,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import { requirePartnerId } from '../rbac/ownership.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import {
  PartnerDocumentsService,
  type UploadedDocument,
} from './partner-documents.service.js';

/**
 * A partner managing their own verification documents (§8.1).
 *
 * Bytes go through the API rather than a presigned upload, for the same reason
 * property images do — except more so. A presigned PUT would land the object
 * unvalidated, and here "unvalidated" means an unreviewed file sitting in a bucket
 * alongside other partners' identity documents.
 */
@Controller('partner/documents')
export class PartnerDocumentsController {
  constructor(private readonly documents: PartnerDocumentsService) {}

  @Get()
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  async list(@CurrentUser() user: AccessTokenClaims | undefined) {
    const partnerId = requirePartnerId(user, P.PROPERTY_MANAGE_OWN);

    return { documents: await this.documents.list(partnerId) };
  }

  @Post()
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AuditExempt('PartnerDocumentsService audits the upload in the same transaction.')
  @UseInterceptors(
    FileInterceptor('file', {
      /**
       * In memory, and capped below the service's own limit as a first line of
       * defence — multer stops reading at the ceiling, so an oversized upload never
       * fully arrives rather than being read and then rejected.
       */
      limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    }),
  )
  async upload(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(partnerDocumentUploadSchema))
    body: PartnerDocumentUploadInput,
    @UploadedFile() file: UploadedDocument | undefined,
  ) {
    const partnerId = requirePartnerId(user, P.PROPERTY_MANAGE_OWN);

    return this.documents.upload(partnerId, body.kind, file, user);
  }

  /** A partner re-reading their own upload, scoped so it cannot reach another's. */
  @Get(':documentId/file')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  @AuditExempt('PartnerDocumentsService records partner_document.viewed.')
  async download(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res() response: Response,
  ) {
    const partnerId = requirePartnerId(user, P.PROPERTY_MANAGE_OWN);
    const doc = await this.documents.read(documentId, user, partnerId);

    sendDocument(response, doc);
  }
}

/**
 * The reviewer's side (§8.1, §9.2, item 121).
 *
 * `PARTNER_DOCUMENT_REVIEW` is held by `operations_manager` and `super_admin` only.
 * Support agents can see that a partner exists but not open their passport — §4.1's
 * "staff see only the data their role requires", applied to the most sensitive
 * document the platform holds.
 */
@Controller('admin/partners')
export class AdminPartnerDocumentsController {
  constructor(private readonly documents: PartnerDocumentsService) {}

  /**
   * Keyed on the partner REFERENCE, not their uuid.
   *
   * `POST /admin/partners/:reference/verify` already works this way, and an admin
   * API that mixes the two invites exactly the bug this replaced: a console linking
   * with one key against an endpoint expecting the other. References are also the
   * §13.2 handle staff quote to each other, and they keep internal ids off the wire.
   */
  @Get(':reference/documents')
  @RequirePermissions(P.PARTNER_DOCUMENT_REVIEW)
  async list(@Param('reference') reference: string) {
    return { documents: await this.documents.listByReference(reference) };
  }

  /**
   * Filing a partner's document for them, during an in-person onboarding
   * (Bashar, 2026-08-23).
   *
   * ## Multipart, not base64 in JSON
   *
   * The contract routes take base64 because a generated PDF is produced server-side and handed
   * back through the same JSON channel. A document is a file somebody chose from a disk, and
   * sending it as multipart keeps it out of `body-parser` entirely — so this route needs no
   * entry in `FILE_BODY_PATHS` and cannot widen the JSON limit for the dozen other routes that
   * share the `/admin/partners` prefix.
   *
   * ## `PARTNER_ONBOARD`, not `PARTNER_DOCUMENT_REVIEW`
   *
   * Reviewing a document and PRODUCING one are different powers. An operations manager reviews
   * what a partner sent; being able to put a document into the record and then approve it is a
   * loop with one person in it, so this stays with the super admin who is running the meeting.
   * The review decision on the row still needs `PARTNER_DOCUMENT_REVIEW`, unchanged.
   *
   * Throttled and capped in memory below the service's own 8MB ceiling, exactly as the partner's
   * own upload is.
   */
  @Post(':reference/documents')
  @RequirePermissions(P.PARTNER_ONBOARD)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @AuditExempt('PartnerDocumentsService audits the upload in the same transaction.')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024, files: 1 } }),
  )
  async upload(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(partnerDocumentUploadSchema))
    body: PartnerDocumentUploadInput,
    @UploadedFile() file: UploadedDocument | undefined,
  ) {
    return this.documents.uploadByReference(reference, body.kind, file, user);
  }

  @Get('documents/:documentId/file')
  @RequirePermissions(P.PARTNER_DOCUMENT_REVIEW)
  @AuditExempt('PartnerDocumentsService records partner_document.viewed with the actor.')
  async download(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res() response: Response,
  ) {
    sendDocument(response, await this.documents.read(documentId, user));
  }

  @Post('documents/:documentId/review')
  @RequirePermissions(P.PARTNER_DOCUMENT_REVIEW)
  @AuditExempt('PartnerDocumentsService records partner_document.reviewed.')
  async review(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body(new ZodValidationPipe(partnerDocumentReviewSchema))
    body: PartnerDocumentReviewInput,
  ) {
    return this.documents.review(documentId, body.decision, body.notes, user);
  }
}

/**
 * Writes a document to the response, defensively.
 *
 * Three headers, each doing real work:
 *
 *  - `attachment` — never rendered in the browser. A PDF is stored verbatim (it
 *    cannot be re-encoded the way an image can), so anything active inside it must
 *    not execute on SAFRA's origin.
 *  - `nosniff` — stops a browser from ignoring the declared type and guessing HTML.
 *  - `no-store` — an identity document must not sit in a shared proxy cache or in
 *    the reviewer's browser cache after they log out.
 *
 * The filename is quoted and was already stripped of control characters, so it
 * cannot inject a second header line.
 */
function sendDocument(
  response: Response,
  doc: { body: Buffer; fileName: string; contentType: string },
): void {
  response
    .setHeader('Content-Type', doc.contentType)
    .setHeader('Content-Disposition', `attachment; filename="${doc.fileName}"`)
    .setHeader('X-Content-Type-Options', 'nosniff')
    .setHeader('Cache-Control', 'no-store')
    .send(doc.body);
}
