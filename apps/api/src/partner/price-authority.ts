import { ERROR, PERMISSIONS as P } from '@safra/contracts';

import { forbidden } from '../common/errors/app-error.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * `price.update` is checked PER FIELD, not per route (Bashar, 2026-08-23).
 *
 * ## Why not `@RequirePermissions(P.PRICE_UPDATE)` on the routes
 *
 * Because the routes are not about pricing. `PATCH /partner/units/:unitId` changes a name, a bed
 * count, an amenity list — and, among those, a base price. `PUT .../calendar` closes dates and,
 * among those, sets a nightly rate. Requiring the capability on either route would refuse an
 * employee renaming a room, and `@RequirePermissions` requires ALL of what it names, so there is no
 * way to spell "and also, if a price is involved" in a decorator.
 *
 * The original comment on `updateUnit` said prices were "gated whole rather than per field", and
 * that was right on 2026-08-19 — one person held the account and a single grant covered everything
 * they could touch. Employees changed the premise. A partner can now grant "manage the listing"
 * without "change prices", and if those two arrive together anyway the second grant means nothing.
 *
 * ## Why a separate call rather than folding it into `requirePartnerId`
 *
 * The permission depends on the BODY, and `requirePartnerId` answers a question about the token.
 * Keeping them apart means the price check is visible at each site that can change a price, which
 * is where somebody adding a third one will be reading.
 *
 * Called AFTER ownership is established at every site, deliberately: a caller who does not own the
 * unit must learn that first, so this cannot be used to probe which units exist.
 */
export function assertMayPrice(
  claims: AccessTokenClaims | undefined,
  changesPrice: boolean,
): void {
  if (!changesPrice) return;

  if (!(claims?.permissions ?? []).includes(P.PRICE_UPDATE)) {
    throw forbidden(ERROR.PERMISSION_DENIED);
  }
}
