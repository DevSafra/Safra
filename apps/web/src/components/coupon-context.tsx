'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/** What a priced coupon leaves behind, once the server has judged it. */
export interface AppliedCoupon {
  readonly code: string;
  readonly discountAmount: string;
  readonly totalAfter: string;
}

interface CouponState {
  readonly applied: AppliedCoupon | null;
  readonly apply: (coupon: AppliedCoupon | null) => void;
}

const Context = createContext<CouponState | null>(null);

/**
 * The applied coupon, shared by the two halves of checkout.
 *
 * ## Why a context and not a prop
 *
 * The coupon is ENTERED in the summary, where the money is, and SUBMITTED by the form, which is a
 * sibling in a server-rendered grid. Without something between them the customer would see one
 * total in the panel and pay another — the single worst outcome this feature could have, and the
 * reason the entry could not simply live inside the form.
 *
 * A provider around both is the smallest thing that keeps them agreeing. The page stays a server
 * component; only the two pieces that need the state are clients.
 *
 * ## What is NOT in here
 *
 * A discount the browser computed. `applied` holds what the SERVER answered, and the booking POST
 * sends only the CODE — the discount is decided again on the server, against prices the server
 * computed, under the coupon's row lock. What the customer saw is never trusted.
 */
export function CouponProvider({ children }: { children: ReactNode }) {
  const [applied, setApplied] = useState<AppliedCoupon | null>(null);

  const value = useMemo<CouponState>(() => ({ applied, apply: setApplied }), [applied]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The applied coupon, or null. Safe outside a provider — checkout is the only place there is one. */
export function useCoupon(): CouponState {
  return useContext(Context) ?? { applied: null, apply: () => undefined };
}
