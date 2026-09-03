/**
 * Which night the customer site should offer, when the one the clock names is closed.
 *
 * §5.3 closes same-day bookings at 17:00 in the CITY's timezone, and the API answers a search for
 * a closed night with a 400 carrying `firstBookableDate`. `searchSafely` turns that into an empty
 * list plus a notice rather than an exception, so every surface that picks a night for the visitor
 * has to decide what to do with the refusal.
 *
 * Getting that wrong is not a missing feature, it is a screen that lies. Twice on 2026-09-02:
 *
 * - «موصى به من سفرة» hid itself, so a whole section of the landing page vanished for the seven
 *   hours after 17:00 Damascus, with nothing in any log to say why.
 * - The search form stayed pre-filled with today, so between 17:00 and midnight the landing page's
 *   primary action was a button that could only ever answer «لا نتائج» — measured at 21:06, zero
 *   results and the API's own «حجوزات اليوم أُغلقت» notice on the far side of it.
 *
 * ## Why this is a function and not three lines in the page
 *
 * Because it was three lines in the page, and the page fixed one of the two paths. The rule this
 * belongs to is «a bug is fixed on every path a person can reach it»: the same decision governs
 * the rail, the search form, the stay-type chips and the attribute shortcuts, and a decision made
 * separately at four call sites is four chances to make it differently. Here it is made once and
 * asserted once.
 *
 * It is deliberately NOT a re-implementation of the cutoff. The API owns that rule — the timezone,
 * the hour, and what "first bookable" means when nine cities sit in it — and this only reads the
 * date the API itself named. A UI that computed the cutoff would drift from the endpoint that
 * enforces it, and the drift would be invisible: the screen would keep offering a night the
 * booking call then refuses.
 */
export type ClosedNightNotice = { firstBookableDate: string };

/**
 * As narrow as the decision needs, and no narrower.
 *
 * `notice` is `| null` because that is what `SearchOutcome` carries — the API states the absence
 * of a notice rather than omitting the key, and a `| undefined` here would refuse the real type at
 * the call site. Optional as well, so a caller with no notice at all can be tested.
 *
 * `items` is `readonly unknown[]`: the decision turns on whether anything came back, never on what.
 * Naming `SearchResultItem` here would tie a date calculation to the search projection's shape.
 */
export type NightOutcome = {
  items: readonly unknown[];
  notice?: ClosedNightNotice | null | undefined;
};

export type Night = {
  checkIn: string;
  checkOut: string;
  /** The party and the nights, as the `?…` a link appends to a property or a search. */
  stay: string;
};

export function night(checkIn: string, checkOut: string): Night {
  /*
    `URLSearchParams`, not a template literal, and the reason is not style. `checkIn` here can be
    `firstBookableDate` — a value that arrives over the wire from the API rather than one this
    module computed. It is a calendar date today and the whole string is appended to an `href`, so
    an `&` or a `#` in it would silently add or truncate parameters on every card link on the page.
    Encoding costs nothing and removes the question. The search page builds its own links the same
    way for the same reason.
  */
  const stay = new URLSearchParams({ checkIn, checkOut, adults: '2' });

  return { checkIn, checkOut, stay: `?${stay.toString()}` };
}

/**
 * The night to ask again for, or `null` when the first answer stands.
 *
 * `null` for a search that FOUND something, and `null` for one that failed for any other reason —
 * an unreachable API, a validation refusal that names no date. Only a stated `firstBookableDate`
 * redirects, because it is the only case where the API has told us where to look instead.
 *
 * An empty list with no notice is a real answer: there is nothing on that night. Retrying it from
 * a date nobody named would turn "no stays are free tonight" into a silent change of subject.
 */
export function retryFrom(first: NightOutcome): Night | null {
  if (first.items.length > 0 || !first.notice) return null;

  const opens = first.notice.firstBookableDate;

  return night(opens, dayAfter(opens));
}

/** The next calendar day, in the `YYYY-MM-DD` the API speaks. */
export function dayAfter(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];

  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}
