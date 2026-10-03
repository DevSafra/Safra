import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { BLOCKING_STATUS_SQL, BLOCKING_STATUSES } from './booking-state.js';

/**
 * «Is this room taken?» has ONE answer in the API (Bashar, 2026-10-03).
 *
 * ## The defect this generalises
 *
 * The question was written out by hand in seven places. The exclusion constraint, booking creation
 * and the console's review screen counted `disputed` as holding its room; the property page (twice),
 * search and the partner calendar did not. So a room under a dispute was shown as free, offered, and
 * refused at the last step with `booking.dates_just_taken`, and a partner saw a night as open while
 * a disputing guest still held it.
 *
 * ## Why a sweep, with no exemption list
 *
 * Fixing the four wrong copies would leave seven copies, and the next status added to
 * `BLOCKING_STATUSES` would reach whichever ones somebody remembered. So a hand-written list of the
 * blocking statuses is itself the failure: the shape is `IN (...)` naming both `pending_payment` and
 * `checked_in`, which is the occupancy question and nothing else (revenue asks about `confirmed`,
 * `checked_in` and `completed`, and is not caught).
 */
const SRC = new URL('../', import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

const HAND_WRITTEN = /IN\s*\(([^)]*)\)/g;

describe('the statuses that hold a room', () => {
  it('render as exactly BLOCKING_STATUSES, in a form a query can use', () => {
    const rendered = new PgDialect().sqlToQuery(sql`status IN ${BLOCKING_STATUS_SQL}`);

    expect(rendered.params).toEqual([]);
    expect(rendered.sql).toBe(
      `status IN (${BLOCKING_STATUSES.map((status) => `'${status}'`).join(', ')})`,
    );
    expect(BLOCKING_STATUSES).toContain('disputed');
  });

  it('are never written out by hand in the API', () => {
    const files = sources(SRC);
    expect(files.length, 'the sweep reached the API source').toBeGreaterThan(100);

    const offenders = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return [...text.matchAll(HAND_WRITTEN)]
        .filter(
          ([, list]) =>
            /'pending_payment'/.test(list ?? '') && /'checked_in'/.test(list ?? ''),
        )
        .map(() => file.slice(SRC.length));
    });

    expect(
      offenders,
      'These files list the statuses that hold a room by hand. Use `IN ${BLOCKING_STATUS_SQL}` from bookings/booking-state.',
    ).toEqual([]);
  });
});
