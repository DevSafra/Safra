import { describe, expect, it } from 'vitest';

import { upcomingTrips } from './group-trips';

const TODAY = new Date('2026-10-02T09:00:00Z');
const trip = (slug: string, endsOn: string) => ({ slug, endsOn });

describe('the home page offers only the trips a reader can still join', () => {
  it('drops a trip that has finished and keeps the rest, in their order', () => {
    const offered = upcomingTrips(
      [
        trip('spring', '2027-04-02'),
        trip('summer', '2026-08-30'),
        trip('winter', '2027-01-10'),
      ],
      TODAY,
    );

    expect(offered.map((one) => one.slug)).toEqual(['spring', 'winter']);
  });

  it('keeps a trip that ends today: it is still on', () => {
    expect(upcomingTrips([trip('last-day', '2026-10-02')], TODAY)).toHaveLength(1);
  });

  it('drops a trip that ended yesterday', () => {
    expect(upcomingTrips([trip('over', '2026-10-01')], TODAY)).toHaveLength(0);
  });
});
