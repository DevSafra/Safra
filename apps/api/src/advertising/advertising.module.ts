import { Module } from '@nestjs/common';

import { AdDeliveryService } from './ad-delivery.service.js';
import { AdvertisingController } from './advertising.controller.js';

/**
 * Customer-facing advertising: delivery and click tracking.
 *
 * Deliberately separate from the ADMIN advertising service, which lives in `admin/`. This one is
 * public and reads; that one is permissioned and writes. Keeping them apart is what stops a
 * customer-facing endpoint acquiring a dependency on the console's scope rules.
 */
@Module({
  controllers: [AdvertisingController],
  providers: [AdDeliveryService],
  exports: [AdDeliveryService],
})
export class AdvertisingModule {}
