import { z } from 'zod';

/**
 * «What is new since I last looked» — and how far down it the reader has got.
 *
 * Bashar, 2026-08-27: a badge counting the new rows on a section, those rows tinted, and both
 * cleared once he has been there. Then, 2026-08-28, the defect in the first attempt: «when I go to
 * the next page on the table, I do not see the new row marked and the badge number get removed…
 * the badge number should only decrease when I see the new rows on the current page».
 *
 * ## Why ONE timestamp could not do it
 *
 * The first version stored a single mark and treated «new» as `created_at > mark`, advancing the
 * mark to `now()` the moment the section was opened. That is wrong in a way that only shows up on
 * page two, and it is worth writing down because the shape looks so reasonable.
 *
 * These registries are ordered NEWEST FIRST, so the new rows sit at the top. Reading page one means
 * seeing the newest of them — and the ones still unread are therefore OLDER than the ones just
 * read. A single forward-moving watermark can only say «everything after X is new», so advancing it
 * past the rows on page one also swallows every unread row beneath them. The unread set is an
 * INTERVAL, and an interval needs two bounds.
 *
 * ## So: two marks per section
 *
 * - `since` — the bottom of the batch. Rows created after it belong to «this batch of new rows»,
 *   and that is what the TINT follows, so a new row stays marked on whatever page it appears on.
 * - `readTo` — the oldest row the reader has actually had on screen. Rows between `since` and
 *   `readTo` are the ones still unread, and that is what the BADGE counts, so it falls by exactly
 *   the new rows each page shows.
 *
 * A batch is retired when the reader LEAVES the section — reporting a different one is that signal.
 * The next batch then starts at `readFrom`, the top of what they were actually shown, so rows that
 * arrived while they were reading are still new to them rather than being swallowed by a boundary
 * stamped at the moment they walked away.
 *
 * Stored in `users.section_seen_at`, beside `table_page_sizes`, for the same reason that one is on
 * the ACCOUNT: what you have already read is a property of the person, not of the laptop.
 */

/**
 * The registries that carry a mark — an ALLOW-LIST, not a free-form key.
 *
 * The security boundary of the whole feature, and the same one `TABLE_SECTIONS` draws: the value
 * becomes a KEY in a `jsonb` column on `users`, a row read on every authenticated request. Without
 * a closed list a caller could write arbitrary keys and arbitrary depth there. With one, the worst
 * a crafted request can do is mark a section read that this person could have opened anyway.
 *
 * Deliberately NOT every section. A mark is only worth keeping where «new rows arrived» is a thing
 * somebody acts on; on الإعدادات or أدوار الموظفين it would be noise with a maintenance cost.
 */
export const SEEN_SECTIONS = ['customers', 'bookings', 'payments', 'wallet'] as const;

export type SeenSection = (typeof SEEN_SECTIONS)[number];

/** One section's marks, as stored and as read back. */
export interface SectionSeen {
  /** Rows created after this are the current batch of «new». Drives the tint. */
  readonly since: string;
  /** The oldest row the reader has had on screen, or `null` if none of the batch yet. */
  readonly readTo: string | null;
  /**
   * The NEWEST row the reader has had on screen, or `null` if none yet.
   *
   * What the next batch starts from, and the reason it exists: retiring a batch at `now()` would
   * swallow every row that arrived WHILE the reader was in the section. Those rows are newer than
   * anything they were shown, so starting the next batch at the top of what they saw keeps them.
   */
  readonly readFrom: string | null;
}

/**
 * What the save endpoint accepts: which section, and the oldest row that was on screen.
 *
 * ## Why the client names the row and the server names the time
 *
 * `readTo` is a fact about the PAGE — «the oldest row I was shown» — which only the client knows,
 * because only the client knows which page, which filter and which size were rendered. Recomputing
 * it on the server would mean running every registry's list query a second time.
 *
 * Nothing about it is trusted beyond its shape. It moves only DOWNWARD (the server takes the
 * minimum), it is ignored if it is in the future, and the batch boundary `since` is still stamped
 * with the database's own clock. The blast radius is the caller's own badge: the worst a crafted
 * value can do is hide rows from the person who sent it, which they could do by scrolling past
 * them anyway.
 */
export const markSeenSchema = z
  .object({
    section: z.enum(SEEN_SECTIONS),
    /** ISO-8601, and only ever used to move `readTo` down. Omitted when the page had no rows. */
    readTo: z.string().datetime({ offset: true }).optional(),
    /** The newest row on the page — only ever used to move `readFrom` up. */
    readFrom: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type MarkSeenInput = z.infer<typeof markSeenSchema>;

/**
 * The badge stops counting at this, and says «99+» rather than a figure past it.
 *
 * Every other sidebar badge counts a BOUNDED queue — bookings awaiting confirmation, partners
 * pending verification — so an exact number is both cheap and meaningful. «New since you last
 * looked» has no such bound: an account that has not opened العملاء for a month would ask the
 * database to count every customer since, on every page view, which rule 2 forbids outright.
 *
 * Ninety-nine because the number stops being actionable long before then: «99+» and «4,812» lead to
 * the same decision, and only one of them costs an unbounded scan. The count query stops reading at
 * `SEEN_BADGE_CAP + 1`, so the cost is fixed whatever the backlog.
 */
export const SEEN_BADGE_CAP = 99;

/**
 * How a badge count is written — `99+` past the cap, so a capped total is never printed as exact.
 *
 * The same rule the tables follow for «أكثر من ١٠٠٠٠ نتيجة»: a number that stopped counting must
 * not present itself as a measurement.
 */
export function seenBadgeLabel(count: number): string {
  return count > SEEN_BADGE_CAP ? `${SEEN_BADGE_CAP}+` : String(count);
}
