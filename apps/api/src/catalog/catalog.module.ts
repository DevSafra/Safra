import { Controller, Get, Module, Param, Query } from '@nestjs/common';

import { ERROR } from '@safra/contracts';

import { notFound } from '../common/errors/app-error.js';

import { Public } from '../rbac/decorators.js';
import { CatalogService } from './catalog.service.js';
import { PropertyDetailService } from './property-detail.service.js';
import { NearbyService } from './nearby.service.js';

/**
 * Public catalogue. @Public() because §5.1 requires a visitor to browse and search
 * without registering — JwtAuthGuard denies by default, so this is explicit.
 */
@Controller()
class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly properties: PropertyDetailService,
    private readonly nearby: NearbyService,
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
   * The listings around this one, for the map's price markers.
   *
   * ## A separate request, on purpose
   *
   * It could have ridden along inside the property payload. It does not, for two reasons.
   * The property page is server-rendered and cached; the neighbour list is only ever needed
   * once somebody opens the full-screen map, which most readers never do — putting it in the
   * main payload would make every visitor pay for a feature a minority use. And it lets the
   * map degrade honestly: if this call fails the map still draws, just without neighbours.
   *
   * ## It takes a SLUG, not a coordinate
   *
   * The centre is looked up from the listing rather than accepted from the caller. A
   * caller-supplied centre would make this a general proximity oracle over the catalogue —
   * ask it about a moving point and the answers map out the area. Anchored to a slug, it can
   * only ever answer the question its own property page already answers.
   */
  @Public()
  @Get('properties/:slug/nearby')
  async nearbyListings(@Param('slug') slug: string) {
    const location = await this.properties.publicLocation(slug);
    if (!location) return { items: [] };

    return {
      items: await this.nearby.around(location.latitude, location.longitude, slug),
    };
  }

  /**
   * The landmarks of one city, for the «قريب من» filter.
   *
   * A query parameter rather than a path segment under `cities/:slug`, because the filter
   * asks for it independently of the city PAGE and nesting it would imply the city payload
   * carries it. An unknown city answers an empty list, not a 404: the caller is populating a
   * `<select>`, and an error status there is a broken filter rather than a message.
   */
  @Public()
  @Get('landmarks')
  async landmarks(@Query('citySlug') citySlug?: string) {
    if (!citySlug) return { items: [] };
    return { items: await this.catalog.landmarks(citySlug) };
  }

  /**
   * One landmark, for the page that leads into a search near it.
   *
   * A 404 for anything unpublished rather than an empty object, because this one HAS a reader:
   * a person following a link, who should meet the site's not-found page rather than a blank
   * screen that looks like a failure.
   */
  @Public()
  @Get('landmarks/:slug')
  async landmark(@Param('slug') slug: string) {
    const found = await this.catalog.landmark(slug);
    if (!found) throw notFound(ERROR.LANDMARK_NOT_FOUND);
    return found;
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
  providers: [CatalogService, PropertyDetailService, NearbyService],
  exports: [CatalogService, PropertyDetailService, NearbyService],
})
export class CatalogModule {}
