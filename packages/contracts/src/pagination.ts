import { z } from 'zod';

/**
 * Cursor (keyset) pagination, not OFFSET.
 *
 * OFFSET makes the database count and discard every skipped row, so page 5,000 of
 * a booking list costs proportionally more than page 1. At the volumes this
 * platform targets that degrades into timeouts. A cursor turns every page into an
 * indexed seek of constant cost.
 *
 * It also fixes a correctness bug OFFSET has: with rows arriving constantly, an
 * OFFSET page can skip or repeat records as earlier rows shift underneath it.
 */
export const cursorQuerySchema = z
  .object({
    /** Hard ceiling of 100 — an unbounded list endpoint is a DoS vector. */
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(200).optional(),
  })
  .strict();

export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export interface CursorPage<T> {
  items: T[];
  /** Opaque cursor for the next page; null when the end has been reached. */
  nextCursor: string | null;
}

/**
 * Cursors are opaque to clients by design: encoding the sort key as base64url
 * signals "do not construct these by hand" and lets the sort key change later
 * without breaking callers.
 *
 * Not encrypted, and not sensitive — it carries only a timestamp and an id the
 * caller is already authorised to see. Authorization is re-applied on every
 * request regardless of what the cursor says, so a forged cursor can shift the
 * page window but never widen access.
 */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

/**
 * Returns null for anything unparseable. Callers MUST treat null as a client
 * error (400) rather than falling back to the first page — see the note in
 * BookingsService.list about infinite pagination loops.
 */
export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = raw.indexOf('|');

    if (separator === -1) {
      return null;
    }

    const createdAt = new Date(raw.slice(0, separator));
    const id = raw.slice(separator + 1);

    if (Number.isNaN(createdAt.getTime()) || id.length === 0) {
      return null;
    }

    return { createdAt, id };
  } catch {
    // A malformed cursor is treated as "start from the beginning" by the caller,
    // never as a 500.
    return null;
  }
}
