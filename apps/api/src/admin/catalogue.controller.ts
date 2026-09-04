import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';

import {
  PERMISSIONS as P,
  amenityCreateSchema,
  amenityUpdateSchema,
  cancellationPolicyCreateSchema,
  cancellationPolicyUpdateSchema,
  partnerTypeCreateSchema,
  partnerTypeUpdateSchema,
  type AmenityCreateInput,
  type AmenityUpdateInput,
  type CancellationPolicyCreateInput,
  type CancellationPolicyUpdateInput,
  type PartnerTypeCreateInput,
  type PartnerTypeUpdateInput,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { CatalogueService } from './catalogue.service.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * كتالوج المنصّة — amenities, cancellation policies and partner types (Bashar, 2026-09-04).
 *
 * ## Reading and changing are different authorities
 *
 * `SETTINGS_READ` opens every list, because operations staff work AGAINST this catalogue all day —
 * they need to see which policy «مرن» is before explaining a refund. `CATALOGUE_MANAGE` is what
 * changes one, and only a super admin holds it.
 *
 * It is not `GEO_MANAGE`, which the city categories beside them use: a role trusted to correct a
 * city's spelling has no business rewriting the refund ladder that every future booking snapshots.
 * Reusing a permission because the screens look alike is how authority quietly widens.
 *
 * ## Its own controller
 *
 * `registries.controller.ts` is already 800 lines across nine registries. Twelve more routes there
 * would be twelve more reasons to read past the one being changed, and these three entities share
 * a service, a permission and a set of rules — which is what a controller is for.
 *
 * ## `@AuditExempt` on every write
 *
 * The service records inside the same transaction as the change, so the interceptor must not
 * record a second, weaker row beside it. Each reason names the action, so the exemption stays
 * checkable rather than becoming a habit.
 */
@Controller('admin/catalogue')
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  // ── Amenities ─────────────────────────────────────────────────────────────

  @Get('amenities')
  @RequirePermissions(P.SETTINGS_READ)
  async amenities() {
    return { amenities: await this.catalogue.amenities() };
  }

  @Post('amenities')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt('CatalogueService records amenity.created inside the transaction.')
  async createAmenity(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(amenityCreateSchema)) body: AmenityCreateInput,
  ) {
    return this.catalogue.createAmenity(user, body);
  }

  @Patch('amenities/:code')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt('CatalogueService records amenity.updated inside the transaction.')
  async updateAmenity(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('code') code: string,
    @Body(new ZodValidationPipe(amenityUpdateSchema)) body: AmenityUpdateInput,
  ) {
    return this.catalogue.updateAmenity(user, code, body);
  }

  @Delete('amenities/:code')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt('CatalogueService records amenity.deleted inside the transaction.')
  async removeAmenity(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('code') code: string,
  ) {
    return this.catalogue.removeAmenity(user, code);
  }

  // ── Cancellation policies ─────────────────────────────────────────────────

  @Get('cancellation-policies')
  @RequirePermissions(P.SETTINGS_READ)
  async cancellationPolicies() {
    return { policies: await this.catalogue.cancellationPolicies() };
  }

  @Post('cancellation-policies')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt(
    'CatalogueService records cancellation_policy.created inside the transaction.',
  )
  async createCancellationPolicy(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(cancellationPolicyCreateSchema))
    body: CancellationPolicyCreateInput,
  ) {
    return this.catalogue.createCancellationPolicy(user, body);
  }

  @Patch('cancellation-policies/:code')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt(
    'CatalogueService records cancellation_policy.updated inside the transaction.',
  )
  async updateCancellationPolicy(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('code') code: string,
    @Body(new ZodValidationPipe(cancellationPolicyUpdateSchema))
    body: CancellationPolicyUpdateInput,
  ) {
    return this.catalogue.updateCancellationPolicy(user, code, body);
  }

  @Delete('cancellation-policies/:code')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt(
    'CatalogueService records cancellation_policy.deleted inside the transaction.',
  )
  async removeCancellationPolicy(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('code') code: string,
  ) {
    return this.catalogue.removeCancellationPolicy(user, code);
  }

  // ── Partner types ─────────────────────────────────────────────────────────

  @Get('partner-types')
  @RequirePermissions(P.SETTINGS_READ)
  async partnerTypes() {
    return { partnerTypes: await this.catalogue.partnerTypes() };
  }

  @Post('partner-types')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt('CatalogueService records partner_type.created inside the transaction.')
  async createPartnerType(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(partnerTypeCreateSchema)) body: PartnerTypeCreateInput,
  ) {
    return this.catalogue.createPartnerType(user, body);
  }

  @Patch('partner-types/:code')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt('CatalogueService records partner_type.updated inside the transaction.')
  async updatePartnerType(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('code') code: string,
    @Body(new ZodValidationPipe(partnerTypeUpdateSchema)) body: PartnerTypeUpdateInput,
  ) {
    return this.catalogue.updatePartnerType(user, code, body);
  }

  @Delete('partner-types/:code')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt('CatalogueService records partner_type.deleted inside the transaction.')
  async removePartnerType(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('code') code: string,
  ) {
    return this.catalogue.removePartnerType(user, code);
  }
}
