import { PUBLIC_COORDINATE_DECIMALS } from '@safra/contracts';

/**
 * Rounds a coordinate to roughly 100 m for public display.
 *
 * The precision, the map's zoom and the area disc all come from `@safra/contracts` —
 * one promise, read by the API that publishes the number and by the app that draws it.
 *
 * The blank check is not defensive tidying. `latitude` and `longitude` are nullable TEXT
 * columns, and `Number('')` is `0` — so an empty string used to round to `"0.000"` and
 * publish the listing at null island in the Gulf of Guinea. Nothing showed it while the
 * payload only carried two numbers nobody rendered; the map turned it into a card of the
 * Atlantic, which is how the test that found it came to be written.
 */
export function fuzzCoordinate(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && value.trim() === '') return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;

  return parsed.toFixed(PUBLIC_COORDINATE_DECIMALS);
}
