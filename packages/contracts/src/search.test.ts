import { describe, expect, it } from 'vitest';

import {
  addDays,
  cityLocalNow,
  evaluateArrival,
  firstBookableDate,
  isSameDayClosed,
  searchQuerySchema,
} from './search.js';

const DAMASCUS = 'Asia/Damascus'; // UTC+3, no DST since 2022
const BEIRUT = 'Asia/Beirut'; //   UTC+2 / UTC+3, observes DST
const AMMAN = 'Asia/Amman'; //     UTC+3, no DST since 2022

describe('cityLocalNow', () => {
  it('reads the local wall clock, not the server clock', () => {
    // 2026-06-15 12:00 UTC → 15:00 in Damascus (UTC+3)
    const local = cityLocalNow(new Date('2026-06-15T12:00:00Z'), DAMASCUS);
    expect(local).toEqual({ date: '2026-06-15', hour: 15, minute: 0 });
  });

  it('rolls the local DATE forward when UTC is still on the previous day', () => {
    // 22:30 UTC is already 01:30 the NEXT day in Damascus.
    const local = cityLocalNow(new Date('2026-06-15T22:30:00Z'), DAMASCUS);
    expect(local.date).toBe('2026-06-16');
    expect(local.hour).toBe(1);
  });

  it('normalises midnight to hour 0 rather than 24', () => {
    // 21:00 UTC = 00:00 next day in Damascus. Some engines render this as "24".
    expect(cityLocalNow(new Date('2026-06-15T21:00:00Z'), DAMASCUS).hour).toBe(0);
  });

  it('tracks DST for Beirut, which still observes it', () => {
    // January: Beirut is UTC+2 → 14:00 UTC = 16:00 local
    expect(cityLocalNow(new Date('2026-01-15T14:00:00Z'), BEIRUT).hour).toBe(16);
    // July: Beirut is UTC+3 → 14:00 UTC = 17:00 local
    expect(cityLocalNow(new Date('2026-07-15T14:00:00Z'), BEIRUT).hour).toBe(17);
  });
});

describe('isSameDayClosed — the 17:00 boundary (§5.3)', () => {
  it('is open just before the cutoff', () => {
    // 13:59 UTC = 16:59 Damascus
    expect(isSameDayClosed(new Date('2026-06-15T13:59:00Z'), DAMASCUS)).toBe(false);
  });

  it('is CLOSED at exactly 17:00 local', () => {
    // The spec permits booking "before 17:00", so 17:00:00 itself is closed.
    expect(isSameDayClosed(new Date('2026-06-15T14:00:00Z'), DAMASCUS)).toBe(true);
  });

  it('is closed after the cutoff', () => {
    expect(isSameDayClosed(new Date('2026-06-15T20:00:00Z'), DAMASCUS)).toBe(true);
  });

  it('reopens after local midnight', () => {
    // 21:30 UTC = 00:30 next day in Damascus — a new booking day.
    expect(isSameDayClosed(new Date('2026-06-15T21:30:00Z'), DAMASCUS)).toBe(false);
  });

  it('honours a configured cutoff other than 17:00', () => {
    // P-005: the hour is a setting, not a constant.
    const instant = new Date('2026-06-15T12:00:00Z'); // 15:00 Damascus
    expect(isSameDayClosed(instant, DAMASCUS, 14)).toBe(true);
    expect(isSameDayClosed(instant, DAMASCUS, 16)).toBe(false);
  });

  /**
   * The test that justifies storing a timezone per city. At one instant, Beirut is
   * still open while Damascus and Amman have closed — so a single server-side
   * cutoff would be wrong for at least one launch market.
   */
  it('gives different verdicts per city at the SAME instant', () => {
    // 2026-01-15 14:30 UTC → Damascus 17:30 (closed), Amman 17:30 (closed),
    // Beirut 16:30 (open, because Beirut is UTC+2 in January).
    const instant = new Date('2026-01-15T14:30:00Z');
    expect(isSameDayClosed(instant, DAMASCUS)).toBe(true);
    expect(isSameDayClosed(instant, AMMAN)).toBe(true);
    expect(isSameDayClosed(instant, BEIRUT)).toBe(false);
  });
});

describe('addDays', () => {
  it('handles a plain increment', () => {
    expect(addDays('2026-06-15', 1)).toBe('2026-06-16');
  });

  it('rolls over month end', () => {
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
  });

  it('rolls over year end', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('handles a non-leap February', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('firstBookableDate', () => {
  it('is today before the cutoff', () => {
    expect(firstBookableDate(new Date('2026-06-15T10:00:00Z'), DAMASCUS)).toBe(
      '2026-06-15',
    );
  });

  it('is tomorrow after the cutoff', () => {
    expect(firstBookableDate(new Date('2026-06-15T15:00:00Z'), DAMASCUS)).toBe(
      '2026-06-16',
    );
  });

  it('crosses year end correctly after the cutoff', () => {
    // 2026-12-31 20:00 UTC = 23:00 Damascus, past cutoff → 2027-01-01
    expect(firstBookableDate(new Date('2026-12-31T20:00:00Z'), DAMASCUS)).toBe(
      '2027-01-01',
    );
  });
});

describe('evaluateArrival', () => {
  it('allows a future date', () => {
    const v = evaluateArrival('2026-07-01', new Date('2026-06-15T10:00:00Z'), DAMASCUS);
    expect(v.allowed).toBe(true);
  });

  it('allows today before the cutoff', () => {
    const v = evaluateArrival('2026-06-15', new Date('2026-06-15T10:00:00Z'), DAMASCUS);
    expect(v.allowed).toBe(true);
  });

  it('rejects today after the cutoff and names the next available date', () => {
    const v = evaluateArrival('2026-06-15', new Date('2026-06-15T15:00:00Z'), DAMASCUS);
    expect(v).toEqual({
      allowed: false,
      firstBookableDate: '2026-06-16',
      reason: 'same_day_closed',
    });
  });

  it('distinguishes a past date from a closed same-day', () => {
    const v = evaluateArrival('2026-06-10', new Date('2026-06-15T15:00:00Z'), DAMASCUS);
    expect(v.reason).toBe('date_in_past');
  });

  it('uses the city calendar, not UTC, to decide what "today" is', () => {
    // 2026-06-15 22:00 UTC is already 2026-06-16 01:00 in Damascus, so the 16th
    // is "today" and bookable — even though UTC still says the 15th.
    const v = evaluateArrival('2026-06-16', new Date('2026-06-15T22:00:00Z'), DAMASCUS);
    expect(v.allowed).toBe(true);
  });
});

describe('searchQuerySchema (§5.2)', () => {
  const base = { checkIn: '2026-07-01', checkOut: '2026-07-05', adults: '2' };

  it('accepts a minimal valid query and coerces numbers', () => {
    const r = searchQuerySchema.parse(base);
    expect(r.adults).toBe(2);
    expect(r.children).toBe(0);
    expect(r.sort).toBe('recommended'); // §5.5: never cheapest by default
  });

  it('requires arrival, departure and guest count', () => {
    // §5.2: "searching or booking without them is not permitted"
    expect(searchQuerySchema.safeParse({ checkIn: '2026-07-01' }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ adults: 2 }).success).toBe(false);
    expect(
      searchQuerySchema.safeParse({ checkIn: '2026-07-01', checkOut: '2026-07-05' })
        .success,
    ).toBe(false);
  });

  it('rejects a departure that is not after arrival', () => {
    expect(searchQuerySchema.safeParse({ ...base, checkOut: '2026-07-01' }).success).toBe(
      false,
    );
    expect(searchQuerySchema.safeParse({ ...base, checkOut: '2026-06-28' }).success).toBe(
      false,
    );
  });

  it('rejects impossible calendar dates the regex would allow', () => {
    expect(searchQuerySchema.safeParse({ ...base, checkIn: '2026-02-30' }).success).toBe(
      false,
    );
    expect(searchQuerySchema.safeParse({ ...base, checkIn: '2026-13-01' }).success).toBe(
      false,
    );
  });

  it('treats city and attributes as optional', () => {
    const r = searchQuerySchema.parse(base);
    expect(r.citySlug).toBeUndefined();
    expect(r.attributes).toEqual([]);
  });

  it('rejects an inverted price range', () => {
    expect(
      searchQuerySchema.safeParse({ ...base, minPrice: 200, maxPrice: 50 }).success,
    ).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(searchQuerySchema.safeParse({ ...base, isAdmin: true }).success).toBe(false);
  });

  it('rejects an unknown trip attribute', () => {
    expect(searchQuerySchema.safeParse({ ...base, attributes: ['nope'] }).success).toBe(
      false,
    );
  });
});

/**
 * The same-day cutoff as a SWITCHABLE rule (Bashar, 2026-09-04).
 *
 * «Verify the behaviour before, exactly at and after the configured cut-off, including cities in
 * different time zones.» Each of those three moments is asserted in both modes, in three zones,
 * because the whole point of the feature is a city's LOCAL clock: the same UTC instant is before
 * the cutoff in one city and after it in another, and a test fixed to one zone would prove nothing
 * about the rule the platform actually runs.
 */
describe('the same-day cutoff, switched on and off', () => {
  /* 16:59, 17:00 and 17:01 in DAMASCUS (UTC+3) — the three moments, as UTC instants. */
  const BEFORE = new Date('2026-09-04T13:59:00Z');
  const AT = new Date('2026-09-04T14:00:00Z');
  const AFTER = new Date('2026-09-04T14:01:00Z');
  const TODAY = '2026-09-04';
  const TOMORROW = '2026-09-05';

  describe('enabled — the existing behaviour, which is the default', () => {
    it('allows today one minute BEFORE the cutoff', () => {
      expect(evaluateArrival(TODAY, BEFORE, DAMASCUS, 17, true).allowed).toBe(true);
    });

    /* EXACTLY at the hour is closed: the rule is «after 17:00», and 17:00 is not before it. */
    it('closes today exactly AT the cutoff', () => {
      const verdict = evaluateArrival(TODAY, AT, DAMASCUS, 17, true);

      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toBe('same_day_closed');
      expect(verdict.firstBookableDate).toBe(TOMORROW);
    });

    it('closes today AFTER the cutoff', () => {
      expect(evaluateArrival(TODAY, AFTER, DAMASCUS, 17, true).allowed).toBe(false);
    });

    /* And the default is ON — an omitted flag must not open same-day booking. */
    it('applies when the flag is not passed at all', () => {
      expect(evaluateArrival(TODAY, AFTER, DAMASCUS, 17).allowed).toBe(false);
    });
  });

  describe('disabled — same day stays available', () => {
    it.each([
      ['before', BEFORE],
      ['at', AT],
      ['after', AFTER],
    ])('allows today %s the cutoff hour', (_when, instant) => {
      const verdict = evaluateArrival(TODAY, instant, DAMASCUS, 17, false);

      expect(verdict.allowed).toBe(true);
      expect(verdict.firstBookableDate).toBe(TODAY);
    });

    /*
      The rule that does NOT go away with it. «Disabled» means the cutoff stops applying, not that
      a night which has already passed becomes sellable — a different rule, with a different reason.
    */
    it('still refuses an arrival in the past', () => {
      const verdict = evaluateArrival('2026-09-03', AFTER, DAMASCUS, 17, false);

      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toBe('date_in_past');
    });
  });

  /**
   * The same instant, three cities — which is the whole reason the rule is city-local.
   *
   * 2026-09-04T14:30Z is 17:30 in Damascus and Amman (UTC+3) and 17:30 in Beirut (UTC+3 in
   * September, on DST). All three are past a 17:00 cutoff. Moving the cutoff to 18 puts all three
   * BEFORE it — so the pair proves the hour is read rather than assumed.
   */
  describe('across time zones', () => {
    const INSTANT = new Date('2026-09-04T14:30:00Z');

    it.each([DAMASCUS, BEIRUT, AMMAN])(
      'closes today in %s past a 17:00 cutoff',
      (zone) => {
        expect(evaluateArrival(TODAY, INSTANT, zone, 17, true).allowed).toBe(false);
      },
    );

    it.each([DAMASCUS, BEIRUT, AMMAN])(
      'allows today in %s under an 18:00 cutoff',
      (zone) => {
        expect(evaluateArrival(TODAY, INSTANT, zone, 18, true).allowed).toBe(true);
      },
    );

    it.each([DAMASCUS, BEIRUT, AMMAN])('allows today in %s when disabled', (zone) => {
      expect(evaluateArrival(TODAY, INSTANT, zone, 17, false).allowed).toBe(true);
    });

    /*
      A zone where the same instant is a DIFFERENT DAY, which is the case a single-zone test can
      never reach: 2026-09-04T22:30Z is already 2026-09-05 in Damascus (01:30). «Today» there is
      the 5th, so an arrival of the 4th is in the PAST — even with the cutoff switched off.
    */
    it('reads the city calendar day, not the server one', () => {
      const pastMidnight = new Date('2026-09-04T22:30:00Z');

      expect(cityLocalNow(pastMidnight, DAMASCUS).date).toBe(TOMORROW);
      expect(evaluateArrival(TODAY, pastMidnight, DAMASCUS, 17, false).reason).toBe(
        'date_in_past',
      );
      expect(evaluateArrival(TOMORROW, pastMidnight, DAMASCUS, 17, false).allowed).toBe(
        true,
      );
    });
  });

  describe('firstBookableDate', () => {
    it('is tomorrow past the cutoff and today under it', () => {
      expect(firstBookableDate(AFTER, DAMASCUS, 17, true)).toBe(TOMORROW);
      expect(firstBookableDate(BEFORE, DAMASCUS, 17, true)).toBe(TODAY);
    });

    it('is always today when the cutoff is off', () => {
      expect(firstBookableDate(AFTER, DAMASCUS, 17, false)).toBe(TODAY);
    });
  });
});
