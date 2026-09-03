'use client';

import { formatMoney } from '@/lib/localise';
import { useCoupon } from './coupon-context';

/**
 * «المطلوب الآن» — the one number the customer is agreeing to pay.
 *
 * A client component solely so it can fall when a coupon is applied. Rendering the undiscounted
 * total here while the coupon panel above says a discount was applied would be the worst outcome
 * this feature could have: a customer seeing one figure and being charged another.
 *
 * The discounted total comes from the SERVER's preview, not from arithmetic done here — the same
 * value the booking will be priced at when it re-judges the code.
 */
export function CheckoutTotal({
  total,
  currencyCode,
  locale,
  label,
  discountLabel,
}: {
  readonly total: string;
  readonly currencyCode: string;
  readonly locale: 'ar' | 'en' | 'de';
  readonly label: string;
  readonly discountLabel: string;
}) {
  const { applied } = useCoupon();

  return (
    <>
      {applied ? (
        <div className="flex justify-between">
          <dt className="text-muted">{discountLabel.replace('{code}', applied.code)}</dt>
          <dd className="text-gold">
            −{formatMoney(applied.discountAmount, currencyCode, locale)}
          </dd>
        </div>
      ) : null}
      <div className="flex justify-between border-t border-line pt-2 text-base">
        <dt className="font-semibold text-text">{label}</dt>
        <dd className="font-semibold text-gold">
          {formatMoney(applied ? applied.totalAfter : total, currencyCode, locale)}
        </dd>
      </div>
    </>
  );
}
