import { relations, sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { createdAt, foreignId, primaryId } from './_shared.js';

/**
 * A snapshot of a sanctions list, as published at one moment (ADR 0002).
 *
 * Snapshots rather than a mutable table of entries, because a screening decision has
 * to stay explicable years later. "We screened this partner on 12 August and found
 * nothing" is only meaningful alongside *what the list said that day* — and the EU
 * consolidated list changes: entities are added, and seven were de-listed in the 2026
 * renewal alone. Overwriting in place would quietly rewrite the evidence behind every
 * past decision.
 *
 * Each refresh inserts a new snapshot and its entries. The newest COMPLETE one is
 * what screening reads; older ones stay for audit.
 */
export const sanctionsSnapshots = pgTable(
  'sanctions_snapshots',
  {
    id: primaryId(),
    /** `eu_consolidated` today. Others (UN, OFAC, UK) would each be a source. */
    source: text('source').notNull(),
    /**
     * The publisher's own version or generation date, when the feed states one.
     *
     * Distinct from `fetchedAt`: a feed fetched today may still be the version
     * published last week, and staleness is a property of the DATA, not of when we
     * happened to download it.
     */
    publishedAt: timestamp('published_at', { withTimezone: true }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * SHA-256 of the raw feed body.
     *
     * Lets a refresh detect "nothing changed" without re-parsing, and lets an auditor
     * confirm the snapshot corresponds to a specific published file.
     */
    contentHash: text('content_hash').notNull(),
    entryCount: integer('entry_count').notNull().default(0),
    /**
     * Null until every entry is written.
     *
     * Screening reads only completed snapshots, so a refresh that dies mid-import
     * leaves a visibly incomplete row rather than a half-populated list that would
     * silently return "no match" for everyone missing from it. A partial sanctions
     * list is more dangerous than no list at all, because it looks like an answer.
     */
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...createdAt,
  },
  (t) => [
    index('sanctions_snapshots_source_idx').on(t.source, t.completedAt),
    index('sanctions_snapshots_hash_idx').on(t.source, t.contentHash),
  ],
);

/**
 * One name on a sanctions list.
 *
 * A row per NAME, not per person: designations carry aliases, transliterations and
 * spelling variants, and each has to be independently searchable. One designated
 * individual with six alias spellings is six rows sharing a `designationId`.
 *
 * That matters most for exactly this platform. Arabic names reach a Latin list
 * through several transliteration conventions — Muhammad, Mohammed, Mohamad — and a
 * screener searching one spelling must still match a list holding another.
 */
export const sanctionsEntries = pgTable(
  'sanctions_entries',
  {
    id: primaryId(),
    snapshotId: foreignId('snapshot_id')
      .notNull()
      .references(() => sanctionsSnapshots.id),
    /** The publisher's identifier for the designated party, shared across aliases. */
    designationId: text('designation_id').notNull(),
    /** 'person' | 'entity' — a partner is screened against both. */
    subjectType: text('subject_type').notNull(),
    /** The name exactly as published, shown to the reviewer. */
    name: text('name').notNull(),
    /**
     * The name reduced for comparison: lower-cased, accents stripped, punctuation
     * removed, Arabic article prefixes dropped. Never displayed — this is what the
     * trigram index searches.
     */
    normalisedName: text('normalised_name').notNull(),
    /** The regulation or programme, so a reviewer can read the basis for listing. */
    programme: text('programme'),
    /** Everything else the feed gave: birth dates, addresses, remarks. */
    details: text('details'),
    ...createdAt,
  },
  (t) => [
    index('sanctions_entries_snapshot_idx').on(t.snapshotId),
    /**
     * The matching index. GIN + trigram, because the query is fuzzy similarity over
     * `normalised_name` — a btree cannot serve `%` or `similarity()` at all, and a
     * sequential scan over a list of this size on every partner verification would be
     * slow enough that someone would be tempted to skip the check.
     *
     * Created in post/0001_constraints.sql: Drizzle cannot express `gin_trgm_ops`.
     */
  ],
);

export const sanctionsSnapshotsRelations = relations(sanctionsSnapshots, ({ many }) => ({
  entries: many(sanctionsEntries),
}));

export const sanctionsEntriesRelations = relations(sanctionsEntries, ({ one }) => ({
  snapshot: one(sanctionsSnapshots, {
    fields: [sanctionsEntries.snapshotId],
    references: [sanctionsSnapshots.id],
  }),
}));

/** Kept out of the table definition; see the note on the index list above. */
export const SANCTIONS_TRIGRAM_INDEX = sql`
  CREATE INDEX IF NOT EXISTS sanctions_entries_name_trgm_idx
    ON sanctions_entries USING gin (normalised_name gin_trgm_ops)
`;
