import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import type { SanctionsSource } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/env.js';
import { normaliseName, tokenOverlap } from './name-normalisation.js';

/** The source SAFRA is legally obliged to screen against (ADR 0002). */
export const EU_SOURCE: SanctionsSource = 'eu_consolidated';

/**
 * A list imported for DEVELOPMENT, which screening will never accept.
 *
 * ## Why a second source rather than a flag on the row
 *
 * A developer needs a list to exercise the screening path locally, and the only way to get one used
 * to be to import a hand-made file AS `eu_consolidated`. Nothing then distinguished it: the
 * snapshot row, the console panel and the screening record all read exactly as they would for the
 * genuine article, and the only marking that survived was a naming convention inside the entries.
 *
 * That is the wrong shape for a compliance control. A screening that answers "no match" against a
 * fabricated list produces a record that LOOKS clean and means nothing — worse than no screening,
 * which is the reasoning `MAX_SNAPSHOT_AGE_DAYS` already gives for refusing a merely stale list.
 *
 * Making it a separate SOURCE makes the refusal structural rather than remembered. `screen()` asks
 * for `EU_SOURCE` and nothing else, so a fixture cannot satisfy it — not because anything checks,
 * but because nothing looks for it. There is no code path in which a fixture becomes compliance,
 * and none can be added by forgetting a flag.
 *
 * `importSnapshot` refuses this source outright in production, so a fixture cannot exist there at
 * all. See `SanctionsService.importSnapshot`.
 */
export const LOCAL_FIXTURE_SOURCE: SanctionsSource = 'local_fixture';

/**
 * Below this trigram similarity a hit is not worth a reviewer's attention.
 *
 * Deliberately low. A false positive costs somebody thirty seconds; a false negative
 * onboards a designated counterparty and is a legal exposure for the German entity.
 * The asymmetry says: over-flag, and let a human decide.
 */
const SIMILARITY_FLOOR = 0.35;

/** At or above this, a hit is reported as strong regardless of token overlap. */
const STRONG_SIMILARITY = 0.75;

/**
 * A snapshot older than this cannot be screened against.
 *
 * Seven days is generous for a list that changes rarely, and the refusal matters
 * more than the number: screening against a list we cannot prove is current *looks*
 * like compliance while providing none. Same reasoning as the FX refusal — an
 * honest failure beats a confident wrong answer.
 */
const MAX_SNAPSHOT_AGE_DAYS = 7;

export interface SanctionsCandidate {
  readonly name: string;
  readonly designationId: string;
  readonly subjectType: string;
  readonly programme: string | null;
  readonly details: string | null;
  /** 0–1 trigram similarity on the normalised names. */
  readonly similarity: number;
  /** 0–1 share of the shorter name's tokens that appear in the other. */
  readonly tokenOverlap: number;
  readonly confidence: 'strong' | 'possible' | 'weak';
}

export interface ScreeningOutcome {
  readonly source: string;
  readonly snapshotId: string;
  readonly listPublishedAt: string | null;
  readonly listFetchedAt: string;
  readonly searched: string[];
  readonly candidates: SanctionsCandidate[];
  readonly matched: boolean;
}

/**
 * The list cannot be screened against.
 *
 * A `ServiceUnavailableException` rather than a plain Error, so it surfaces as a 503
 * with a usable message instead of a bare 500. The distinction matters here more than
 * usual: this is a STAFF endpoint, so unlike the customer-facing FX refusal the
 * message says exactly what is wrong and what to do — the person reading it is the
 * one who can fix it.
 */
export class SanctionsListUnavailableError extends ServiceUnavailableException {
  constructor(readonly reason: 'missing' | 'stale') {
    super(
      reason === 'missing'
        ? 'No sanctions list has been imported. Screening is unavailable until one ' +
            'is: set SANCTIONS_FEED_URL, or POST the export to /admin/sanctions/import.'
        : 'The sanctions list is older than the 7-day limit, so it cannot be shown ' +
            'to be current. Refresh it before screening.',
    );
    this.name = 'SanctionsListUnavailableError';
  }
}

/**
 * Screening a partner against the EU consolidated list (ADR 0002, §8.1).
 *
 * A German merchant entity is bound by EU sanctions law. Regulation (EU) 2025/1098
 * lifted the economic measures in 2025, but asset freezes on persons and entities
 * tied to the former al-Assad regime were renewed on 2026-05-18 until 2027-06-01 —
 * so screening a Syrian-market counterparty is an obligation, not a precaution.
 *
 * ## What this does and does not decide
 *
 * It never approves or rejects anybody. It returns CANDIDATES with a confidence, and
 * a human decides. Automating the decision would mean either blocking legitimate
 * partners on letter-overlap coincidence, or — far worse — silently clearing someone
 * because a transliteration did not line up.
 *
 * ## Why matching is deliberately noisy
 *
 * The floor is 0.35 similarity, which produces obvious rubbish alongside real hits.
 * That is the intended trade: a reviewer dismissing a bad suggestion loses seconds,
 * while a missed designation is a legal exposure. Every candidate carries both its
 * raw similarity and its token overlap so the reviewer can see WHY it surfaced.
 */
@Injectable()
export class SanctionsService {
  private readonly logger = new Logger(SanctionsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Screens a set of names — a partner's legal name, trading name and contact.
   *
   * Several names rather than one because a designation may name the company or the
   * person signing for it, and a partner registers with both.
   */
  async screen(names: string[], source = EU_SOURCE): Promise<ScreeningOutcome> {
    const snapshot = await this.currentSnapshot(source);

    const searchable = names
      .map((name) => ({ raw: name, normalised: normaliseName(name) }))
      .filter((entry) => entry.normalised.length >= 3);

    /**
     * Nothing searchable is NOT the same as nothing found.
     *
     * A name that normalises away entirely would silently match nothing, so it is
     * reported as an unusable input rather than a clean result.
     */
    if (searchable.length === 0) {
      return {
        source,
        snapshotId: snapshot.id,
        listPublishedAt: snapshot.published_at,
        listFetchedAt: snapshot.fetched_at,
        searched: [],
        candidates: [],
        matched: false,
      };
    }

    const candidates = new Map<string, SanctionsCandidate>();

    for (const entry of searchable) {
      const rows = await this.db.execute<{
        name: string;
        designation_id: string;
        subject_type: string;
        programme: string | null;
        details: string | null;
        similarity: number;
      }>(sql`
        SELECT name, designation_id, subject_type, programme, details,
               similarity(normalised_name, ${entry.normalised}) AS similarity
        FROM sanctions_entries
        WHERE snapshot_id = ${snapshot.id}
          AND similarity(normalised_name, ${entry.normalised}) >= ${SIMILARITY_FLOOR}
        ORDER BY similarity DESC
        LIMIT 25
      `);

      for (const row of rows.rows) {
        const overlap = tokenOverlap(entry.raw, row.name);
        const similarity = Number(row.similarity);

        const candidate: SanctionsCandidate = {
          name: row.name,
          designationId: row.designation_id,
          subjectType: row.subject_type,
          programme: row.programme,
          details: row.details,
          similarity: Math.round(similarity * 100) / 100,
          tokenOverlap: Math.round(overlap * 100) / 100,
          confidence: rate(similarity, overlap),
        };

        /**
         * Keyed by the entry NAME, not the designation: one designated person has
         * many aliases, and a reviewer wants to see which spelling matched rather
         * than a deduplicated designation with the reason hidden.
         */
        const existing = candidates.get(row.name);

        if (!existing || existing.similarity < candidate.similarity) {
          candidates.set(row.name, candidate);
        }
      }
    }

    const ranked = [...candidates.values()].sort((a, b) => b.similarity - a.similarity);

    /**
     * `matched` means "a human must look", not "this person is sanctioned".
     *
     * Anything above weak sets it, because the flag drives whether the reviewer is
     * warned — and under-warning is the failure mode that matters.
     */
    const matched = ranked.some((candidate) => candidate.confidence !== 'weak');

    this.logger.log(
      `Screened ${searchable.length} name(s) against ${source}: ` +
        `${ranked.length} candidate(s), matched=${matched}.`,
    );

    return {
      source,
      snapshotId: snapshot.id,
      listPublishedAt: snapshot.published_at,
      listFetchedAt: snapshot.fetched_at,
      searched: searchable.map((entry) => entry.raw),
      candidates: ranked.slice(0, 25),
      matched,
    };
  }

  /**
   * The newest complete snapshot, or a refusal.
   *
   * Refuses on missing AND on stale, for the same reason: a screening run against a
   * list nobody can prove is current produces a record that looks like compliance
   * and is not. Better to stop verification than to write that record.
   */
  private async currentSnapshot(source: string): Promise<{
    id: string;
    published_at: string | null;
    fetched_at: string;
    age_days: number;
  }> {
    const rows = await this.db.execute<{
      id: string;
      published_at: string | null;
      fetched_at: string;
      age_days: string;
    }>(sql`
      SELECT id, published_at::text, fetched_at::text,
             (EXTRACT(EPOCH FROM (now() - fetched_at)) / 86400)::text AS age_days
      FROM sanctions_snapshots
      WHERE source = ${source} AND completed_at IS NOT NULL
      ORDER BY completed_at DESC
      LIMIT 1
    `);

    const row = rows.rows[0];

    if (!row) {
      this.logger.error(
        `No ${source} snapshot has been imported. Partner verification is blocked ` +
          `until one is: run the sanctions refresh, or import a list manually.`,
      );
      throw new SanctionsListUnavailableError('missing');
    }

    const ageDays = Number(row.age_days);

    if (ageDays > MAX_SNAPSHOT_AGE_DAYS) {
      this.logger.error(
        `The ${source} snapshot is ${Math.round(ageDays)} days old, past the ` +
          `${MAX_SNAPSHOT_AGE_DAYS}-day limit. Refusing to screen against a list ` +
          `that cannot be shown to be current.`,
      );
      throw new SanctionsListUnavailableError('stale');
    }

    return { ...row, age_days: ageDays };
  }

  /**
   * Imports a parsed list as a new snapshot.
   *
   * The snapshot row is written first and `completed_at` last, so a crash mid-import
   * leaves a visibly incomplete snapshot that screening ignores — rather than a
   * half-populated list that would confidently report "no match" for everyone who
   * had not been inserted yet.
   */
  async importSnapshot(input: {
    source: string;
    rawBody: string;
    publishedAt?: Date | undefined;
    entries: ImportEntry[];
  }): Promise<{ snapshotId: string; entryCount: number; unchanged: boolean }> {
    /**
     * A fixture cannot be created in production, at all.
     *
     * The structural refusal — `screen()` only ever asking for `EU_SOURCE` — already means a
     * fixture can never become compliance. This is the second lock: it means the row cannot exist
     * in the first place, so nobody can be looking at a production database wondering which of two
     * snapshots is the real one.
     *
     * Thrown rather than silently ignored, because an import that quietly did nothing would leave
     * whoever ran it believing a list was loaded.
     */
    if (input.source === LOCAL_FIXTURE_SOURCE && this.env.NODE_ENV === 'production') {
      throw new Error(
        'Refusing to import a local fixture sanctions list in production. Fixtures exist so a ' +
          'developer can exercise the screening path; a real environment must screen against the ' +
          'real list or refuse to screen at all.',
      );
    }

    const contentHash = createHash('sha256').update(input.rawBody, 'utf8').digest('hex');

    /**
     * An unchanged feed is a no-op, not a new snapshot.
     *
     * The EU list changes rarely; re-importing an identical body daily would bury the
     * genuine revisions among hundreds of duplicates, and the audit value of a
     * snapshot is precisely that it marks a change.
     */
    const existing = await this.db.execute<{ id: string; entry_count: number }>(sql`
      SELECT id, entry_count FROM sanctions_snapshots
      WHERE source = ${input.source} AND content_hash = ${contentHash}
        AND completed_at IS NOT NULL
      LIMIT 1
    `);

    const unchangedRow = existing.rows[0];

    if (unchangedRow) {
      /**
       * `fetched_at` is bumped even though the content did not change, because
       * staleness is about whether we have CHECKED recently, not whether the
       * publisher happened to revise anything.
       */
      await this.db.execute(sql`
        UPDATE sanctions_snapshots SET fetched_at = now() WHERE id = ${unchangedRow.id}
      `);

      return {
        snapshotId: unchangedRow.id,
        entryCount: unchangedRow.entry_count,
        unchanged: true,
      };
    }

    const created = await this.db.execute<{ id: string }>(sql`
      INSERT INTO sanctions_snapshots (source, published_at, content_hash, entry_count)
      VALUES (${input.source}, ${input.publishedAt?.toISOString() ?? null},
              ${contentHash}, 0)
      RETURNING id
    `);

    const snapshotId = created.rows[0]?.id;
    if (!snapshotId) throw new Error('Snapshot insert returned no row.');

    // Batched: the EU list runs to thousands of names, and a statement per row
    // would turn a refresh into minutes of round trips.
    const BATCH = 500;
    let written = 0;

    for (let index = 0; index < input.entries.length; index += BATCH) {
      const batch = input.entries.slice(index, index + BATCH);

      const values = batch.map(
        (entry) =>
          sql`(${snapshotId}, ${entry.designationId}, ${entry.subjectType}, ${entry.name},
               ${normaliseName(entry.name)}, ${entry.programme ?? null},
               ${entry.details ?? null})`,
      );

      await this.db.execute(sql`
        INSERT INTO sanctions_entries
          (snapshot_id, designation_id, subject_type, name, normalised_name,
           programme, details)
        VALUES ${sql.join(values, sql`, `)}
      `);

      written += batch.length;
    }

    await this.db.execute(sql`
      UPDATE sanctions_snapshots
      SET entry_count = ${written}, completed_at = now()
      WHERE id = ${snapshotId}
    `);

    this.logger.log(
      `Imported ${written} ${input.source} entries as snapshot ${snapshotId}.`,
    );

    return { snapshotId, entryCount: written, unchanged: false };
  }

  /**
   * What the admin screen shows about list freshness.
   *
   * `fixtureLoaded` is about the DATABASE rather than about `source`: it says whether a development
   * fixture is present at all. Without it the console tells a reviewer who has just imported a
   * fixture that no list has been imported — true of the EU list, and baffling to the person
   * looking at their own successful import. Saying which of the two situations they are in turns
   * an apparently broken screen into an explained one.
   *
   * It cannot be true in production, where `importSnapshot` refuses the source outright.
   */
  async status(source = EU_SOURCE): Promise<{
    imported: boolean;
    stale: boolean;
    entryCount: number;
    fetchedAt: string | null;
    publishedAt: string | null;
    ageDays: number | null;
    fixtureLoaded: boolean;
  }> {
    const fixtures = await this.db.execute<{ present: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM sanctions_snapshots
        WHERE source = ${LOCAL_FIXTURE_SOURCE} AND completed_at IS NOT NULL
      ) AS present
    `);

    const fixtureLoaded = fixtures.rows[0]?.present === true;

    const rows = await this.db.execute<{
      entry_count: number;
      fetched_at: string;
      published_at: string | null;
      age_days: string;
    }>(sql`
      SELECT entry_count, fetched_at::text, published_at::text,
             (EXTRACT(EPOCH FROM (now() - fetched_at)) / 86400)::text AS age_days
      FROM sanctions_snapshots
      WHERE source = ${source} AND completed_at IS NOT NULL
      ORDER BY completed_at DESC LIMIT 1
    `);

    const row = rows.rows[0];

    if (!row) {
      return {
        imported: false,
        stale: true,
        entryCount: 0,
        fetchedAt: null,
        publishedAt: null,
        ageDays: null,
        fixtureLoaded,
      };
    }

    const ageDays = Number(row.age_days);

    return {
      imported: true,
      stale: ageDays > MAX_SNAPSHOT_AGE_DAYS,
      entryCount: row.entry_count,
      fetchedAt: new Date(row.fetched_at).toISOString(),
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
      ageDays: Math.round(ageDays),
      fixtureLoaded,
    };
  }
}

export interface ImportEntry {
  readonly designationId: string;
  readonly subjectType: string;
  readonly name: string;
  readonly programme?: string | undefined;
  readonly details?: string | undefined;
}

/**
 * Grades a hit.
 *
 * Similarity alone over-reports: two unrelated Arabic names share long letter runs.
 * Token overlap alone under-reports: a misspelling shares no exact token. Requiring
 * BOTH to be middling, or similarity alone to be high, is what separates "look at
 * this" from "this surfaced because the alphabet is small".
 */
function rate(similarity: number, overlap: number): 'strong' | 'possible' | 'weak' {
  if (similarity >= STRONG_SIMILARITY) return 'strong';
  if (overlap >= 0.5 && similarity >= 0.45) return 'possible';
  if (similarity >= 0.6) return 'possible';

  return 'weak';
}
