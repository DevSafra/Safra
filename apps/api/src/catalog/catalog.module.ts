import {
  Controller,
  Get,
  Module,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { ERROR } from '@safra/contracts';

import { Public } from '../rbac/decorators.js';
import { notFound } from '../common/errors/app-error.js';
import { CatalogService } from './catalog.service.js';
import { PropertyDetailService } from './property-detail.service.js';
import { isMapVariant, PropertyMapService } from './property-map.service.js';

/**
 * Public catalogue. @Public() because §5.1 requires a visitor to browse and search
 * without registering — JwtAuthGuard denies by default, so this is explicit.
 */
@Controller()
class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly properties: PropertyDetailService,
    private readonly maps: PropertyMapService,
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
  /*
    The stay is OPTIONAL and only ever narrows what the rooms claim.

    Without dates the page still lists every room; with them, each says whether it can be booked
    for that window. A reader who has not chosen dates is not told anything about availability,
    which is the honest answer rather than a default window's answer.
  */
  @Get('properties/:slug')
  async property(
    @Param('slug') slug: string,
    @Query('checkIn') checkIn?: string,
    @Query('checkOut') checkOut?: string,
  ) {
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    const stay =
      checkIn && checkOut && iso.test(checkIn) && iso.test(checkOut) && checkIn < checkOut
        ? { checkIn, checkOut }
        : undefined;

    return this.properties.bySlug(slug, stay);
  }

  /**
   * The location map for one published listing (O-web-12).
   *
   * `@Public()` because the property page it sits on is public. The variant is matched
   * against a closed set before it reaches the service — an unknown one 404s rather
   * than being coerced into a default, so a caller cannot invent sizes we then pay to
   * render. `map/:variant.webp` is spelled as a two-segment path because Nest treats a
   * dot in a parameter as part of the value, which would hand the service `card.webp`.
   *
   * The throttle is per IP and deliberately generous: a reader opening ten listings
   * fetches ten maps, and every one of those is a cache hit after the first visitor.
   * It is there to bound a script, not a person.
   */
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('properties/:slug/map/:variant.webp')
  async propertyMap(
    @Param('slug') slug: string,
    @Param('variant') variant: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    if (!isMapVariant(variant)) throw notFound(ERROR.PROPERTY_NOT_FOUND);

    const bytes = await this.maps.image(slug, variant);

    /*
      Set HERE, on the success path, and deliberately not with `@Header`.

      The decorator writes the header before the handler runs, so it survived onto the
      404 — and a 404 cached `public, max-age=604800` is a week of shared caches
      insisting a map does not exist. Every reason this endpoint 404s is TEMPORARY: a
      plan not yet bought, coordinates not yet recorded, a listing not yet published.
      Caching those would mean the feature stayed broken for a week after the thing that
      was missing arrived, on exactly the machines that had looked early.
    */
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('Cache-Control', 'public, max-age=604800');

    return new StreamableFile(bytes);
  }

  /** The business kinds «انضم كشريك» offers. See the service for why these are rows. */
  @Public()
  @Get('partner-types')
  async partnerTypes() {
    return this.catalog.partnerTypes();
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
  providers: [CatalogService, PropertyDetailService, PropertyMapService],
  exports: [CatalogService, PropertyDetailService],
})
export class CatalogModule {}
