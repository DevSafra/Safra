import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';

import {
  PERMISSIONS as P,
  type PropertyImageAltInput,
  type PropertyImageOrderInput,
  propertyImageAltSchema,
  propertyImageOrderSchema,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { RefusedWhileSuspended } from '../rbac/suspended-partner.guard.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import { RequireVerifiedPartner } from '../rbac/verified-partner.guard.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { PropertyImageService } from './property-images.service.js';

/**
 * Property image management (roadmap item 81, feeding §5.6's gallery and §7.2's manager).
 *
 * Multipart upload rather than a presigned URL. A presigned PUT would let the browser write
 * straight to the bucket and save us the bandwidth, but it also means the object lands
 * **unvalidated** — we could not decode it, strip its EXIF, or confirm it is even an image before
 * it is publicly readable. Routing bytes through the API keeps that guarantee; if bandwidth
 * becomes the constraint, the fix is a presigned upload into a quarantine bucket plus a processing
 * worker, not skipping validation.
 *
 * Every route is scoped by the service to the `partnerId` in the VERIFIED token, and answers 404
 * for another partner's reference so it cannot be probed. The logic lives in
 * `PropertyImageService`; this file is the HTTP surface.
 */
/*
  Every write here is an IMAGE, and step 7 puts images behind verification (Bashar, 2026-08-19).

  On the CLASS rather than on five handlers: a decorator that has to be remembered five times is a
  decorator that will be missing from the sixth. There is no read route on this controller — the
  partner's own listing images are returned with the property — so nothing is over-gated by this.
*/
@RequireVerifiedPartner()
@Controller('partner/properties/:reference/images')
export class PartnerImagesController {
  constructor(private readonly images: PropertyImageService) {}

  @Get()
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  @AuditExempt('A partner reading their own gallery; changes nothing.')
  async list(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.images.list(user, reference);
  }

  /* Refused while suspended: uploading an image to a listing — all of it is modifying a listing. */
  @RefusedWhileSuspended()
  @Post()
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  @AuditExempt('Audited transactionally alongside the property_images insert.')
  // Image processing is CPU-heavy, so the budget is tighter than the global one.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      // Held in memory: sharp needs the whole buffer, and a temp file would be one
      // more place an unvalidated upload could sit.
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  async upload(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @UploadedFile()
    file: { buffer: Buffer; mimetype: string; originalname: string } | undefined,
  ) {
    return this.images.upload(user, reference, file);
  }

  /**
   * The display order, as the FULL list of ids.
   *
   * A PATCH on the collection rather than on each image: the order is a property of the set, and
   * applying it one row at a time leaves a window where two images share a position.
   */
  /* Refused while suspended: reordering a listing's images — all of it is modifying a listing. */
  @RefusedWhileSuspended()
  @Patch('order')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  @AuditExempt('Audited transactionally inside PropertyImageService.reorder.')
  async reorder(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(propertyImageOrderSchema)) body: PropertyImageOrderInput,
  ) {
    return this.images.reorder(user, reference, body);
  }

  /**
   * Makes one image the cover.
   *
   * Declared AFTER `order` so `:imageId` does not swallow it — Nest matches routes in declaration
   * order, and a literal segment placed second is a route that never fires.
   */
  /* Refused while suspended: changing the cover image — all of it is modifying a listing. */
  @RefusedWhileSuspended()
  @Post(':imageId/cover')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  @AuditExempt('Audited transactionally inside PropertyImageService.setCover.')
  async setCover(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Param('imageId') imageId: string,
  ) {
    return this.images.setCover(user, reference, imageId);
  }

  /** Alternative text, per locale — the accessibility half of a gallery. */
  /* Refused while suspended: editing image copy — all of it is modifying a listing. */
  @RefusedWhileSuspended()
  @Patch(':imageId/alt')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  @AuditExempt('Copy, not a decision about money, access or visibility.')
  async setAlt(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Param('imageId') imageId: string,
    @Body(new ZodValidationPipe(propertyImageAltSchema)) body: PropertyImageAltInput,
  ) {
    return this.images.setAlt(user, reference, imageId, body);
  }

  /** Soft delete only (P-003). The stored objects are intentionally left in place. */
  /* Refused while suspended: removing an image — all of it is modifying a listing. */
  @RefusedWhileSuspended()
  @Delete(':imageId')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  @AuditExempt('Audited transactionally alongside the soft delete.')
  async remove(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Param('imageId') imageId: string,
  ) {
    return this.images.archive(user, reference, imageId);
  }
}
