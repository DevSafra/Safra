import { Controller, Get, Module, Param } from '@nestjs/common';

import { Public } from '../rbac/decorators.js';
import { CatalogService } from './catalog.service.js';
import { PropertyDetailService } from './property-detail.service.js';

/**
 * Public catalogue. @Public() because §5.1 requires a visitor to browse and search
 * without registering — JwtAuthGuard denies by default, so this is explicit.
 */
@Controller()
class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly properties: PropertyDetailService,
  ) {}

  @Public()
  @Get('cities')
  async cities() {
    return this.catalog.cities();
  }

  @Public()
  @Get('cities/:slug')
  async city(@Param('slug') slug: string) {
    return this.catalog.city(slug);
  }

  /** §5.6 — the full property page payload. */
  @Public()
  @Get('properties/:slug')
  async property(@Param('slug') slug: string) {
    return this.properties.bySlug(slug);
  }

  @Public()
  @Get('property-types')
  async propertyTypes() {
    return this.catalog.propertyTypes();
  }

  /**
   * The cancellation policies a partner may choose from (§7.4).
   *
   * Public because the customer site already prints a listing's policy terms — these are SAFRA's
   * published terms, not internal configuration. A partner picks from this list and cannot invent
   * terms, which is what `PROPERTY_CANCELLATION_POLICY_UNKNOWN` enforces on the way in.
   */
  @Public()
  @Get('cancellation-policies')
  async cancellationPolicies() {
    return this.catalog.cancellationPolicies();
  }

  @Public()
  @Get('amenities')
  async amenities() {
    return this.catalog.amenities();
  }

  @Public()
  @Get('settings/public')
  async settings() {
    return this.catalog.publicSettings();
  }
}

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, PropertyDetailService],
  exports: [CatalogService, PropertyDetailService],
})
export class CatalogModule {}
