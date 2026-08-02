import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '@safra/db';

import { parseEuSanctionsXml } from './eu-list.parser.js';
import { EU_SOURCE, SanctionsService } from './sanctions.service.js';

/**
 * Sanctions screening against a REAL PostgreSQL (ADR 0002).
 *
 * Everything load-bearing here is in the database: `pg_trgm` similarity, the GIN
 * index that makes it usable, and the "newest COMPLETE snapshot" query that decides
 * which list is authoritative. None of it can be exercised with a mock.
 *
 * The tests lean on refusals and on false negatives. A false positive wastes a
 * reviewer's half-minute; a missed designation onboards a sanctioned counterparty
 * and is a legal exposure for the German entity.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** A realistic fragment of the EU export, in the published shape. */
const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<export generationDate="2026-07-28T03:00:00Z">
  <sanctionEntity logicalId="13579" euReferenceNumber="EU.1234.56">
    <subjectType code="P" classificationCode="person"/>
    <regulation programme="SYR" numberTitle="36/2012"/>
    <nameAlias firstName="Bashar" lastName="Al-Assad" wholeName="Bashar Al-Assad"/>
    <nameAlias wholeName="Bachar Al Assad"/>
    <nameAlias wholeName="Bashar Hafez al-Assad"/>
    <birthdate birthdate="1965-09-11"/>
    <remark>President of the Syrian Arab Republic</remark>
  </sanctionEntity>
  <sanctionEntity logicalId="24680" euReferenceNumber="EU.9876.54">
    <subjectType code="E" classificationCode="enterprise"/>
    <regulation programme="SYR" numberTitle="36/2012"/>
    <nameAlias wholeName="Commercial Bank of Syria"/>
    <nameAlias wholeName="Syrian Commercial Bank"/>
  </sanctionEntity>
  <sanctionEntity logicalId="11111">
    <subjectType code="P" classificationCode="person"/>
    <nameAlias wholeName="Muhammad Nasif Khayrbik"/>
  </sanctionEntity>
</export>`;

describeIfDb('sanctions screening', () => {
  let db: Database;
  let sanctions: SanctionsService;

  beforeAll(() => {
    db = createDatabase(DATABASE_URL as string, 3);
    sanctions = new SanctionsService(db);
  });

  afterAll(async () => {
    await clearSnapshots(db);
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  beforeEach(async () => {
    await clearSnapshots(db);
  });

  // ── Refusals ────────────────────────────────────────────────────────────────

  describe('when no list is available', () => {
    /**
     * The most important behaviour in the file. Screening with nothing imported must
     * not quietly return "no match" — that record would look like compliance and be
     * the opposite.
     */
    it('refuses rather than reporting a clean result', async () => {
      await expect(sanctions.screen(['Bashar Al-Assad'])).rejects.toThrow(
        /no sanctions list/i,
      );
    });

    it('refuses when the newest snapshot is too old', async () => {
      await importSample(sanctions);

      await db.execute(sql`
        UPDATE sanctions_snapshots SET fetched_at = now() - interval '30 days'`);

      await expect(sanctions.screen(['Bashar Al-Assad'])).rejects.toThrow(
        /older than the 7-day limit/i,
      );
    });

    /**
     * A crash mid-import leaves entries with no `completed_at`. Screening against
     * that would search a partial list and confidently clear everyone missing from
     * it — worse than having no list at all, because it produces an answer.
     */
    it('ignores an incomplete snapshot', async () => {
      await importSample(sanctions);
      await db.execute(sql`UPDATE sanctions_snapshots SET completed_at = NULL`);

      await expect(sanctions.screen(['Bashar Al-Assad'])).rejects.toThrow(
        /no sanctions list/i,
      );
    });

    it('reports status honestly when nothing is imported', async () => {
      const status = await sanctions.status();

      expect(status.imported).toBe(false);
      expect(status.stale).toBe(true);
    });
  });

  // ── Matching ────────────────────────────────────────────────────────────────

  describe('matching', () => {
    beforeEach(async () => {
      await importSample(sanctions);
    });

    it('finds an exact designated name', async () => {
      const outcome = await sanctions.screen(['Bashar Al-Assad']);

      expect(outcome.matched).toBe(true);
      expect(outcome.candidates[0]?.name).toContain('Assad');
      expect(outcome.candidates[0]?.confidence).toBe('strong');
    });

    /**
     * The reason this platform needs fuzzy matching at all. A Syrian partner's name
     * reaches an EU list through a transliteration nobody agreed on.
     */
    it('finds a designation through a different transliteration', async () => {
      const outcome = await sanctions.screen(['Bashar al Asad']);

      expect(outcome.matched).toBe(true);
      expect(outcome.candidates.some((c) => c.name.includes('Assad'))).toBe(true);
    });

    it('finds a designated organisation', async () => {
      const outcome = await sanctions.screen(['Commercial Bank of Syria']);

      expect(outcome.matched).toBe(true);
      expect(outcome.candidates[0]?.subjectType).toBe('entity');
    });

    it('matches an alias spelling, not only the primary name', async () => {
      const outcome = await sanctions.screen(['Bachar Al Assad']);

      expect(outcome.matched).toBe(true);
    });

    /** An unrelated partner must pass cleanly, or the queue becomes unusable. */
    it('clears a name with nothing in common', async () => {
      const outcome = await sanctions.screen(['Layla Karim Tourism']);

      expect(outcome.matched).toBe(false);
    });

    it('reports the snapshot it screened against', async () => {
      const outcome = await sanctions.screen(['Bashar Al-Assad']);

      expect(outcome.source).toBe(EU_SOURCE);
      expect(outcome.snapshotId).toMatch(/^[0-9a-f-]{36}$/);
      expect(outcome.listPublishedAt).toContain('2026-07-28');
    });

    /**
     * Every candidate carries WHY it surfaced. A reviewer dismissing a hit needs to
     * see that it scored 0.4 on letters and shares no name part — otherwise the only
     * options are trusting the machine or ignoring it.
     */
    it('explains each candidate with similarity and token overlap', async () => {
      const outcome = await sanctions.screen(['Bashar Al-Assad']);
      const candidate = outcome.candidates[0];

      expect(candidate?.similarity).toBeGreaterThan(0);
      expect(candidate?.similarity).toBeLessThanOrEqual(1);
      expect(candidate?.tokenOverlap).toBeGreaterThan(0);
      expect(candidate?.programme).toBe('SYR');
    });

    /**
     * A name that normalises away is an unusable INPUT, not a clean result — it must
     * not silently produce "no match".
     */
    it('returns nothing searched for an unusable name', async () => {
      const outcome = await sanctions.screen(['...', '  ']);

      expect(outcome.searched).toStrictEqual([]);
      expect(outcome.matched).toBe(false);
    });
  });

  // ── Import ──────────────────────────────────────────────────────────────────

  describe('importing', () => {
    it('stores one row per alias, sharing a designation', async () => {
      await importSample(sanctions);

      const rows = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text AS count FROM sanctions_entries
        WHERE designation_id = '13579'`);

      // Three spellings of the same person.
      expect(rows.rows[0]?.count).toBe('3');
    });

    /** Re-importing an identical feed must not bury real revisions in duplicates. */
    it('recognises an unchanged feed and does not create a snapshot', async () => {
      const first = await importSample(sanctions);
      const second = await importSample(sanctions);

      expect(second.unchanged).toBe(true);
      expect(second.snapshotId).toBe(first.snapshotId);
    });

    /** Staleness is about when we last CHECKED, not when the publisher last revised. */
    it('refreshes fetchedAt even when the content is unchanged', async () => {
      await importSample(sanctions);

      await db.execute(sql`
        UPDATE sanctions_snapshots SET fetched_at = now() - interval '30 days'`);

      await importSample(sanctions);

      const status = await sanctions.status();
      expect(status.stale).toBe(false);
    });

    it('records the publisher’s generation date', async () => {
      await importSample(sanctions);

      const status = await sanctions.status();
      expect(status.publishedAt).toContain('2026-07-28');
    });
  });
});

// ─── Parser ───────────────────────────────────────────────────────────────────

describe('parseEuSanctionsXml', () => {
  it('extracts every alias as its own searchable entry', () => {
    const parsed = parseEuSanctionsXml(SAMPLE_XML);

    expect(parsed.entries).toHaveLength(6);
    expect(parsed.entries.map((e) => e.name)).toContain('Bashar Hafez al-Assad');
  });

  it('distinguishes people from organisations', () => {
    const parsed = parseEuSanctionsXml(SAMPLE_XML);

    const bank = parsed.entries.find((e) => e.name.includes('Commercial Bank'));
    const person = parsed.entries.find((e) => e.name.includes('Bashar'));

    expect(bank?.subjectType).toBe('entity');
    expect(person?.subjectType).toBe('person');
  });

  it('carries the programme and identifying details', () => {
    const parsed = parseEuSanctionsXml(SAMPLE_XML);
    const entry = parsed.entries.find((e) => e.name === 'Bashar Al-Assad');

    expect(entry?.programme).toBe('SYR');
    expect(entry?.details).toContain('1965-09-11');
  });

  it('reads the generation date', () => {
    expect(parseEuSanctionsXml(SAMPLE_XML).publishedAt?.getUTCFullYear()).toBe(2026);
  });

  it('falls back to name parts when wholeName is absent', () => {
    const xml = `<export><sanctionEntity logicalId="1">
      <subjectType code="P"/>
      <nameAlias firstName="Ali" lastName="Mamluk"/>
    </sanctionEntity></export>`;

    expect(parseEuSanctionsXml(xml).entries[0]?.name).toBe('Ali Mamluk');
  });

  it('decodes XML entities in a name', () => {
    const xml = `<export><sanctionEntity logicalId="1">
      <subjectType code="E"/>
      <nameAlias wholeName="Smith &amp; Sons Trading"/>
    </sanctionEntity></export>`;

    expect(parseEuSanctionsXml(xml).entries[0]?.name).toBe('Smith & Sons Trading');
  });

  /**
   * The single most dangerous outcome available to this parser: importing an empty
   * list as a valid snapshot would clear every partner screened against it while
   * looking entirely healthy.
   */
  it('throws rather than returning an empty list', () => {
    expect(() => parseEuSanctionsXml('<export></export>')).toThrow(/refusing to import/i);
    expect(() => parseEuSanctionsXml('<html>Login required</html>')).toThrow(
      /refusing to import/i,
    );
  });

  it('skips an entry with no usable identifier', () => {
    const xml = `<export>
      <sanctionEntity><nameAlias wholeName="No Id Here"/></sanctionEntity>
      <sanctionEntity logicalId="2"><nameAlias wholeName="Has An Id"/></sanctionEntity>
    </export>`;

    const parsed = parseEuSanctionsXml(xml);

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.name).toBe('Has An Id');
  });
});

async function importSample(sanctions: SanctionsService) {
  const parsed = parseEuSanctionsXml(SAMPLE_XML);

  return sanctions.importSnapshot({
    source: EU_SOURCE,
    rawBody: SAMPLE_XML,
    publishedAt: parsed.publishedAt,
    entries: parsed.entries,
  });
}

/**
 * Snapshots are test data rather than reference data, so clearing them wholesale is
 * safe — the seed deliberately imports no list, since a stale hardcoded one would be
 * worse than none.
 */
async function clearSnapshots(db: Database): Promise<void> {
  await db.execute(sql`DELETE FROM sanctions_entries`);
  await db.execute(sql`DELETE FROM sanctions_snapshots`);
}
