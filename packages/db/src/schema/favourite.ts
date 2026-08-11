import { relations } from 'drizzle-orm';
import { index, pgTable, uniqueIndex } from 'drizzle-orm/pg-core';

import { foreignId, primaryId, timestamps } from './_shared.js';
import { customerProfiles } from './identity.js';
import { properties } from './property.js';

/**
 * المفضلة — the properties a customer has saved (handoff §6).
 *
 * One of §6's eight account sections, and the only one that needed a table of its own: the others
 * read data the platform already held.
 *
 * ## Soft deleted, like everything else
 *
 * P-003 forbids hard deletes, and a wishlist is no exception even though "unsave" feels like removal.
 * What that buys here is not auditability so much as HONESTY about a question the business will ask —
 * which listings people save and then drop is a real signal, and a row that was deleted outright
 * cannot answer it.
 *
 * ## Why the unique index is not partial
 *
 * `(customer_profile_id, property_id)` is unique across ALL rows, deleted or not, so there is at most
 * one row per pair for ever. Saving again REVIVES that row by clearing `deleted_at` rather than
 * inserting a second one — which makes the add idempotent with a plain `ON CONFLICT` and keeps the
 * history in one place. A partial unique index over the undeleted rows would allow a growing pile of
 * tombstones per pair, and then "when did you first save this" has several answers.
 */
export const favourites = pgTable(
  'favourites',
  {
    id: primaryId(),
    customerProfileId: foreignId('customer_profile_id')
      .notNull()
      .references(() => customerProfiles.id),
    propertyId: foreignId('property_id')
      .notNull()
      .references(() => properties.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('favourites_customer_property_unique').on(
      t.customerProfileId,
      t.propertyId,
    ),
    /* المفضلة itself: this customer's saved listings, newest first, keyset-paged. */
    index('favourites_customer_idx').on(t.customerProfileId, t.createdAt),
  ],
);

export const favouritesRelations = relations(favourites, ({ one }) => ({
  customer: one(customerProfiles, {
    fields: [favourites.customerProfileId],
    references: [customerProfiles.id],
  }),
  property: one(properties, {
    fields: [favourites.propertyId],
    references: [properties.id],
  }),
}));
