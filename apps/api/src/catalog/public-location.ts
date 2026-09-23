/**
 * Narrowing for the coordinates a visitor is allowed to see.
 *
 * ## The rounding moved into the database, deliberately
 *
 * This file used to hold `fuzzCoordinate`, which rounded `properties.latitude` on the way
 * out of the one endpoint that published it. That worked exactly as long as every read path
 * remembered to call it — and the map work of 2026-09-23 added three more paths that need
 * the public pair. Each was a fresh chance to select the raw column by mistake, and the
 * mistake is invisible in review: the payload looks the same, only sharper.
 *
 * `properties.public_latitude` / `public_longitude` are now GENERATED ALWAYS columns, so the
 * rounding is the schema's job and the finer value is unreachable from a public query rather
 * than merely discouraged. The empty-string guard moved with it: `nullif(latitude, '')` in
 * the column definition, instead of a check each caller had to repeat. (`Number('')` is 0,
 * which used to publish a listing at null island in the Gulf of Guinea.)
 *
 * What is left here is the narrowing every raw-SQL row needs. `node-postgres` returns
 * `numeric` as a STRING to avoid the precision loss of a float64 — which is what we want,
 * since the value is already formatted to exactly three decimals — but a raw row is typed
 * `unknown`, and coercing an unexpected object would publish `"[object Object]"` as a
 * latitude.
 */
export function publicCoordinate(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  return null;
}
