import { Module } from '@nestjs/common';

import { CouponService } from './coupon.service.js';

/**
 * الكوبونات — validation and redemption.
 *
 * Deliberately thin: the service depends on the database and nothing else. A coupon is judged
 * against a stay whose price has already been computed, so pricing does not depend on coupons and
 * coupons do not depend on pricing — the cycle that would otherwise form the moment either one
 * reached for the other.
 */
@Module({
  providers: [CouponService],
  exports: [CouponService],
})
export class CouponModule {}
