/**
 * Shared configuration and thresholds for every k6 scenario.
 *
 * ## The thresholds ARE the success criteria
 *
 * `docs/load-testing.md` says a run passes only if every criterion holds simultaneously, and that a
 * p95 met while the error rate is 0.5 % is a system shedding load rather than serving it. Expressing
 * both as k6 thresholds is what makes that literal: k6 exits non-zero when any threshold fails, so a
 * run cannot be reported as green by reading the percentile and ignoring the errors.
 *
 * ## What these numbers mean on a laptop
 *
 * Nothing, as capacity. The plan is explicit — "a figure measured on a laptop is worse than no
 * figure, because somebody will plan around it" — because there is no load balancer, no CDN, no
 * network between the app and the database, and the database has a laptop's IO. What a local run IS
 * good for: seeing which path breaks FIRST, and catching a missing index, which is a property of the
 * query plan and not of the hardware.
 *
 * So: run these locally to find bugs, and never quote the numbers as a capacity figure.
 */

/** The API under test. Overridden per environment with `-e API_URL=…`. */
export const API = `${__ENV.API_URL || 'http://localhost:4000'}/api/v1`;

/** The customer web app, for the pages that are server-rendered rather than API calls. */
export const WEB = __ENV.WEB_URL || 'http://localhost:3000';

/** The staff console, for the registry scenario. */
export const ADMIN = __ENV.ADMIN_URL || 'http://localhost:3001';

/**
 * Rule 3's budgets, unchanged, plus the two the plan derives.
 *
 * `http_req_failed` counts non-2xx/3xx. It is set at 0.1 % rather than zero because the plan states
 * 0.1 %, and a threshold that permits nothing would fail on a single connection reset in a
 * twenty-minute ramp and tell nobody anything.
 */
export const THRESHOLDS = {
  http_req_duration: ['p(95)<200', 'p(99)<500'],
  http_req_failed: ['rate<0.001'],
};

/** Booking creation gets its own budget: it holds an exclusion constraint while it runs. */
export const BOOKING_THRESHOLDS = {
  http_req_duration: ['p(99)<1000'],
  http_req_failed: ['rate<0.001'],
};

/**
 * The documented ramp for scenario 1: 50 → 500 → 2,000 over 20 minutes, holding 10 at each step.
 *
 * Exported as a function so a smoke run can ask for a fraction of it. A scenario file that hard-coded
 * the full ramp would be unusable for the thirty-second check that the script itself works, and the
 * usual result of that is a script only ever run once, wrong.
 */
export function ramp(fraction = 1) {
  const vus = (n) => Math.max(1, Math.round(n * fraction));
  const hold = fraction >= 1 ? '10m' : `${Math.max(10, Math.round(600 * fraction))}s`;
  const rise = fraction >= 1 ? '20s' : '5s';

  return [
    { duration: rise, target: vus(50) },
    { duration: hold, target: vus(50) },
    { duration: rise, target: vus(500) },
    { duration: hold, target: vus(500) },
    { duration: rise, target: vus(2000) },
    { duration: hold, target: vus(2000) },
    { duration: rise, target: 0 },
  ];
}

/** `LOAD_FRACTION=0.01` turns any scenario into a smoke test of itself. */
export const FRACTION = Number(__ENV.LOAD_FRACTION || '1');

/** A date `days` from today, as the `YYYY-MM-DD` the contracts require. */
export function isoDate(days) {
  const at = new Date();

  at.setUTCDate(at.getUTCDate() + days);

  return at.toISOString().slice(0, 10);
}

/**
 * A search query with a spread of filters.
 *
 * Varied per iteration on purpose. Every virtual user asking for the same dates and the same city
 * would be answered from PostgreSQL's cache after the first one, and the run would measure the cache
 * rather than the index — the most common way a load test reports a number that production does not
 * reproduce.
 */
export function searchQuery(seed) {
  const cities = ['damascus', 'aleppo', 'latakia', 'tartus', 'palmyra', 'petra', 'aqaba'];
  const types = ['apartment', 'hotel', 'villa', 'chalet', 'farm'];
  const sorts = ['recommended', 'price_asc', 'price_desc', 'rating_desc'];
  const checkIn = 1 + (seed % 300);

  const params = {
    checkIn: isoDate(checkIn),
    checkOut: isoDate(checkIn + 1 + (seed % 5)),
    adults: 1 + (seed % 4),
    sort: sorts[seed % sorts.length],
    limit: 20,
  };

  /* Two thirds of real searches name a destination; a third browse everything. */
  if (seed % 3 !== 0) params.citySlug = cities[seed % cities.length];
  if (seed % 4 === 0) params.propertyTypeCode = types[seed % types.length];
  if (seed % 7 === 0) params.freeCancellationOnly = 'true';

  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
}
