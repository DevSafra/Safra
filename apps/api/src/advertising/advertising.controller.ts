import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { Public } from '../rbac/decorators.js';
import { AdDeliveryService } from './ad-delivery.service.js';

const deliverySchema = z
  .object({
    citySlug: z.string().trim().min(1).max(120),
    locale: z.enum(['ar', 'en', 'de']).default('ar'),
  })
  .strict();

/**
 * The customer-facing half of الإعلانات: what to show, and where a click goes.
 *
 * `@Public()` throughout — a customer browsing a city has not signed in, and requiring an account
 * to be shown an ad would mean the placement an advertiser paid for reaches almost nobody.
 */
@Controller('ads')
export class AdvertisingController {
  constructor(private readonly delivery: AdDeliveryService) {}

  /**
   * The live ads for one city.
   *
   * Throttled generously: this is called once per city page view and a real customer browsing
   * quickly must not be refused. Impressions are counted here, server-side, from what was actually
   * returned — never from a call the browser makes, which would be a number anybody could inflate.
   */
  @Public()
  @Get()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async forCity(
    @Query(new ZodValidationPipe(deliverySchema)) query: z.infer<typeof deliverySchema>,
  ) {
    return { items: await this.delivery.forCity(query.citySlug, query.locale) };
  }

  /**
   * Counts a click and sends the customer on.
   *
   * ## The destination comes from the ROW
   *
   * Never from the request. A redirect target a caller can influence is an open redirect on
   * SAFRA's own domain — a phishing primitive carrying our name — and this endpoint exists exactly
   * so the browser never holds the advertiser's URL.
   *
   * ## 302, and `rel=noopener` is not enough
   *
   * A redirect rather than a link because the click must be counted first. The `Referrer-Policy`
   * header keeps SAFRA's path out of the advertiser's logs: which city a customer was browsing is
   * ours, not theirs.
   */
  @Public()
  @Get(':reference/click')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async click(
    @Param('reference') reference: string,
    @Res() response: Response,
  ): Promise<void> {
    const target = await this.delivery.click(reference);

    response.setHeader('Referrer-Policy', 'no-referrer');
    response.redirect(302, target);
  }
}
