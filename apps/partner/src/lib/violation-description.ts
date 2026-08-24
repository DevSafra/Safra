import { fill, t } from '@/lib/strings';

/**
 * What a violation SAYS happened, for any violation — including the ones nobody typed a word for.
 *
 * ## The gap this closes
 *
 * Bashar reported twice that the descriptions were missing, and the second report was the useful
 * one. A violation raised by hand on the console carries the operator's own sentence, stored on the
 * row since 2026-08-24. But the violations a partner actually RECEIVES are written by the platform:
 * `sla.service.ts` levies `no_response` and FINES for it, `booking-actions.service.ts` records
 * `rejected_after_payment`, and neither writes any prose at all. So the violations that cost money
 * were exactly the ones with no explanation, and adding the column had not changed that.
 *
 * ## Stored words win, always
 *
 * When somebody wrote a description, that is what the partner reads. The catalogue sentence is the
 * FALLBACK for a machine-written violation, never an override of a human one — an operator who
 * described a specific case must not be paraphrased by a generic line.
 *
 * ## Why the fallback is not written into the row
 *
 * A generated sentence stored in `description` would be frozen in whichever language the sweep
 * picked, on a row that outlives every re-translation. That is «No user-facing text is written
 * inside code» defeated one layer down, in the database, where no lint rule can see it. Resolved
 * here instead, a German partner reads German.
 *
 * ## One resolver, two screens
 *
 * The list and the detail page both call this. Two copies of "which sentence does this violation
 * get" is how the same violation comes to read differently depending on which screen you opened —
 * the defect `statusTone` and `StatusPill` exist to prevent for colour, applied to prose.
 */
export function violationDescription(violation: {
  readonly kind: string;
  readonly description: string | null;
  readonly bookingReference?: string | null;
}): string | null {
  if (violation.description) return violation.description;

  const withBooking = t.violations.defaultDescription[violation.kind];

  if (violation.bookingReference && withBooking) {
    return fill(withBooking, { reference: violation.bookingReference });
  }

  /*
    No booking: the variant that does not mention one, and only for the kinds that HAVE such a
    variant. `stale_calendar` and the rest never name a booking, so their single sentence serves
    both cases and appears only in `defaultDescription`.
  */
  const withoutBooking =
    t.violations.defaultDescriptionNoBooking[violation.kind] ??
    (violation.bookingReference ? undefined : withBooking);

  /*
    Null rather than a placeholder when a kind has no sentence yet.

    A new `violation_kind` added to the enum and not to the catalogue must render NOTHING rather than
    a de-underscored key or an empty line — the screen then looks incomplete, which is how it gets
    noticed. `label()` returning the raw key is the same rule for a different surface.
  */
  return withoutBooking ?? null;
}
