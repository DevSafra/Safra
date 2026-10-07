import { DEFAULT_MONEY_CURRENCY } from '@safra/contracts';

/**
 * Money aggregates, one figure PER CURRENCY — never one figure across them.
 *
 * ## Why not a single number
 *
 * The console's totals were `SUM(amount)` over rows in whatever currency each was written in, and
 * the screen labelled the result USD. SAFRA has priced in five currencies and the books still hold
 * SYP-denominated entries; SYP and USD differ by four orders of magnitude, so one legacy SYP gift
 * card turned «revenue today» into a dollar figure larger than the platform has ever earned.
 *
 * Converting instead was considered and is not done here. The per-row snapshot every row carries
 * converts to SYP (`amount_syp`, `total_syp`), which is the unit the books are kept in and is not
 * shown on any screen since 2026-09-14; converting to USD would mean choosing a rate for rows that
 * never had one, which is the open decision in FUTURE-WORK («do SAFRA's books move from SYP to
 * USD?»). Grouping needs no rate and cannot be wrong: on a single-currency platform it is ONE
 * figure, and on a day a second currency appears the screen shows two rather than inventing one.
 */
export interface CurrencyTotal {
  readonly currency: string;
  readonly amount: string;
}

/** The platform's own currency first, then the rest by code, so a tile reads the same every load. */
function byPlatformFirst(a: string, b: string): number {
  if (a === b) return 0;
  if (a === DEFAULT_MONEY_CURRENCY) return -1;
  if (b === DEFAULT_MONEY_CURRENCY) return 1;

  return a < b ? -1 : 1;
}

/**
 * Rows of `(currency, amount)` from a `GROUP BY` currency, as totals.
 *
 * The amounts pass through as the database wrote them: Postgres summed them in `numeric`, and
 * re-adding in floating point here would be the one place a cent could move. A `null` currency is
 * the empty side of an outer join and is dropped. An empty result is `[]`, not a zero in some
 * currency: the screen renders «nothing» in the platform currency, which is where that fallback
 * belongs.
 */
export function currencyTotals(
  rows: readonly { readonly currency: string | null; readonly amount: string | null }[],
): CurrencyTotal[] {
  return rows
    .flatMap((row) =>
      row.currency === null || row.amount === null
        ? []
        : [{ currency: row.currency, amount: row.amount }],
    )
    .sort((a, b) => byPlatformFirst(a.currency, b.currency));
}

/**
 * A bucketed money series, split into one series per currency.
 *
 * `rows` is a `generate_series` of buckets LEFT JOINed to the money and grouped by
 * `(bucket, currency)`, so every bucket appears at least once — with a `null` currency when it
 * holds nothing. Each currency's series then carries EVERY bucket, a quiet one as zero, so its
 * bars stay under their own labels.
 *
 * A window with no money at all still yields one series, in the platform currency, all zero: the
 * chart draws flat, which is the honest picture, rather than disappearing.
 */
export function seriesByCurrency(
  rows: readonly {
    readonly bucket: string;
    readonly currency: string | null;
    readonly value: string;
  }[],
): { readonly currency: string; readonly series: { bucket: string; value: string }[] }[] {
  const buckets = [...new Set(rows.map((row) => row.bucket))];
  const found = [
    ...new Set(rows.flatMap((row) => (row.currency === null ? [] : [row.currency]))),
  ].sort(byPlatformFirst);
  const currencies = found.length > 0 ? found : [DEFAULT_MONEY_CURRENCY];

  return currencies.map((currency) => ({
    currency,
    series: buckets.map((bucket) => ({
      bucket,
      value:
        rows.find((row) => row.bucket === bucket && row.currency === currency)?.value ??
        '0',
    })),
  }));
}
