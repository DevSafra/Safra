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

  /**
   * The currencies a visitor may ask to see prices in, and the rates that make that possible.
   *
   * ## Why the rates are public
   *
   * They are not a secret: every one of them is already implied by a price the site prints. What
   * they are is INCOMPLETE — `fx_rates` holds whatever staff have recorded, which today is one
   * pair. So this endpoint answers "what can be converted", and the customer app shows an amount
   * in its own currency whenever the answer is "not this one". That is the honest failure mode; the
   * alternative is a price in euros that came from nowhere.
   *
   * ## What it deliberately does NOT do
   *
   * Convert. A rate applied by the API would put a converted figure into a payload that also
   * carries the real one, and the two would eventually be confused at a call site. Conversion is a
   * DISPLAY concern and stays on the display side, where the rule "contractual amounts are never
   * converted" can be enforced per surface.
   */
  @Public()
  @Get('currencies')
  async currencies() {
    return this.catalog.currencies();
  }
}

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, PropertyDetailService],
  exports: [CatalogService, PropertyDetailService],
})
export class CatalogModule {}
