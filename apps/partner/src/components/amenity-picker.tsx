'use client';

import type { OfferableAmenity } from '@/lib/api';
import { t } from '@/lib/strings';

/**
 * Which amenities a unit declares (Bashar, 2026-09-05).
 *
 * ## Why this did not exist
 *
 * `unit_amenities` was empty on every database. The API accepted `amenityCodes` on unit create and
 * on unit update, wrote the links correctly, and had done since the schema was written; the portal
 * never sent the field. So the customer property page had an amenities section with nothing in it,
 * the search sidebar listed nothing to filter by, and a super admin managing the catalogue was
 * curating a list no listing could use.
 *
 * ## Checkboxes, grouped, not a multi-select
 *
 * A partner ticks what their place HAS. That is a set of independent yes/no facts, which is what a
 * checkbox is; a `<select multiple>` hides the unticked options, makes the current answer invisible
 * without scrolling, and is close to unusable on a phone. The groups are the catalogue's own —
 * مرافق، قواعد، إتاحة — so the form reads the way the console curates it.
 *
 * ## The codes are the API's, not this component's
 *
 * Every option comes from `GET /partner/amenities`, which lists what SAFRA still offers. A
 * hard-coded list here would offer amenities the API refuses the moment a super admin retires one
 * — the shape `partner-employee-roles.controller.ts` already warns about: «a hand-written list on
 * the screen would offer capabilities the API rejects».
 *
 * ## Controlled, and the caller owns the set
 *
 * The parent holds the array because it is part of the unit's patch, and a picker with its own
 * state would have to be told when a save succeeded in order to stop disagreeing with the row.
 */
export function AmenityPicker({
  amenities,
  selected,
  onChange,
  idPrefix,
}: {
  readonly amenities: readonly OfferableAmenity[];
  readonly selected: readonly string[];
  readonly onChange: (codes: string[]) => void;
  /** Unique per form: several unit editors are open on one page, each with the same codes. */
  readonly idPrefix: string;
}) {
  const c = t.editProperty;

  if (amenities.length === 0) {
    return <p className="text-[11.5px] text-faint">{c.amenitiesNone}</p>;
  }

  const groups = new Map<string, OfferableAmenity[]>();

  for (const amenity of amenities) {
    groups.set(amenity.category, [...(groups.get(amenity.category) ?? []), amenity]);
  }

  const toggle = (code: string) =>
    onChange(
      selected.includes(code)
        ? selected.filter((one) => one !== code)
        : [...selected, code],
    );

  return (
    <fieldset className="grid gap-2.5" data-amenity-picker={idPrefix}>
      <legend className="text-[12px] text-muted">{c.amenities}</legend>

      {/*
        What is declared RIGHT NOW, as a sentence, above the boxes that change it.
        «Clear display of selected amenities» (Bashar, 2026-09-05) — a grid of ticks is how you
        EDIT a set and a poor way to READ one: answering «what does this unit offer» from it means
        scanning thirty checkboxes for the ticked ones. The absence is stated too, because a blank
        line where a summary belongs reads as a rendering fault rather than as an empty set.
      */}
      <p
        data-amenity-summary={idPrefix}
        className={`text-[11.5px] leading-relaxed ${selected.length > 0 ? 'text-text2' : 'text-faint'}`}
      >
        {selected.length > 0
          ? amenities
              .filter((one) => selected.includes(one.code))
              .map((one) => one.nameAr)
              .join(' · ')
          : c.amenitiesEmpty}
      </p>

      <p className="text-[10.5px] leading-relaxed text-faint2">{c.amenitiesHint}</p>

      {[...groups.entries()].map(([category, list]) => (
        <div key={category} className="grid gap-1.5">
          <p className="text-[10.5px] font-bold text-faint">{groupLabel(category)}</p>

          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {list.map((amenity) => (
              /*
                The LABEL is the tap target — `globals.css` gives one wrapping a checkbox the 40px
                floor below `lg`, because a 16px tick is not something a thumb can hit.
              */
              <label
                key={amenity.code}
                className="flex cursor-pointer items-center gap-2 text-[12px] text-text2"
              >
                <input
                  type="checkbox"
                  id={`${idPrefix}-amenity-${amenity.code}`}
                  checked={selected.includes(amenity.code)}
                  onChange={() => toggle(amenity.code)}
                  className="size-4 shrink-0 cursor-pointer accent-gold"
                />
                {amenity.nameAr}
              </label>
            ))}
          </div>
        </div>
      ))}
    </fieldset>
  );
}

/**
 * The catalogue's own group names.
 *
 * A code with no word falls back to «مرافق» rather than printing the identifier — the same
 * decision the console's `groupLabel` makes, so a category added to the enum and not to the
 * catalogue reads as a group rather than as a fault.
 */
function groupLabel(category: string): string {
  const c = t.editProperty;

  if (category === 'rules') return c.amenityGroupRules;
  if (category === 'accessibility') return c.amenityGroupAccessibility;

  return c.amenityGroupFacilities;
}
