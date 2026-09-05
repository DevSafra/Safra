import { describe, expect, it } from 'vitest';

import { propertyUpdateSchema } from './property.js';

/**
 * A PATCH schema may not invent a field the caller did not send.
 *
 * `propertyBaseSchema.attributes` carries `.default([])`, which is right on a create and a trap on
 * a patch: `.partial()` makes a field optional and leaves its default in place, so parsing
 * `{ address: '…' }` returned `{ address: '…', attributes: [] }`. `PropertiesService.update` writes
 * `attributes` whenever it is defined, so **every partner edit cleared the listing's trip
 * attributes** — a partner correcting an address lost «جبلي» and «عائلي» with it, silently.
 *
 * It also made an amenity-only patch look structural, which is how it was found on 2026-09-06: the
 * API refused with `property.not_structurally_editable` and named a field the caller never sent.
 *
 * Asserted over EVERY key rather than over `attributes` alone. The defect is the shape, not the
 * field, and the next `.default()` added to the base schema would reintroduce it somewhere else.
 */
describe('the property patch schema', () => {
  it('returns only the keys it was given', () => {
    const sent = { address: 'شارع بغداد ١٢' };
    const parsed = propertyUpdateSchema.parse(sent);

    expect(Object.keys(parsed).sort()).toStrictEqual(Object.keys(sent).sort());
  });

  it('still accepts attributes when they are actually sent', () => {
    const parsed = propertyUpdateSchema.parse({ attributes: ['mountain'] });

    expect(parsed.attributes).toStrictEqual(['mountain']);
  });

  /* An empty list is a real instruction — "remove them all" — and must survive. */
  it('treats an empty attribute list as a change, not as absence', () => {
    const parsed = propertyUpdateSchema.parse({ attributes: [] });

    expect(parsed.attributes).toStrictEqual([]);
  });
});
