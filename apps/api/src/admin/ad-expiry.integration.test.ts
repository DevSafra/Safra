import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AdExpiryService } from './ad-expiry.service.js';
import { AdvertisingService } from './advertising.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { JobRunService } from '../common/jobs/job-run.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * A campaign whose paid window has closed.
 *
 * ## The defect this replaces
 *
 * `setStatus` refused to resume a campaign whose `status` was `expired`, and its comment said why:
 * «resuming it would deliver impressions nobody bought». But `expired` had NO WRITER — there was no
 * ad sweep among the scheduled jobs and the list selected `status` raw — so the guard could never
 * fire. A campaign whose window closed last month could be flipped straight back to `active`.
 *
 * The enforcement was reading a column no writer maintained. That is the shape worth remembering:
 * the reasoning was right and the guard was inert, and nothing on the screen said so.
 *
 * ## Three things, and each is asserted against what the others cannot do
 *
 * The GUARD asks the clock, so the hole is closed whether or not the sweep runs. The SWEEP makes
 * the column true for everything that queries it without knowing to compensate. The LIST computes
 * the effective status, so the hour between them is not a window where the screen disagrees with
 * what the API will allow.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('an ad campaign past its window', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const expiry = new AdExpiryService(db, new JobRunService(db));
  const advertising = new AdvertisingService(db, new AuditService(db));

  let staffId = '';

  /** A super admin: unscoped, so the scope check is never what refuses in these cases. */
  const STAFF = (sub: string): AccessTokenClaims =>
    ({
      sub,
      role: 'super_admin',
      permissions: ['ad.manage'],
    }) as unknown as AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();

    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status)
      VALUES ('ad-' || gen_random_uuid() || '@safra.test', '+963900000130', 'super_admin', 'active')
      RETURNING id
    `);

    staffId = made.rows[0]?.id ?? '';
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /** A campaign whose window ends `days` from now — negative for one already closed. */
  async function campaign(days: number, status = 'active'): Promise<string> {
    const made = await db.execute<{ reference: string }>(sql`
      WITH adv AS (
        INSERT INTO advertisers (name, kind, city_id)
        SELECT 'مطعم الاختبار', 'restaurant',
               (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1)
        RETURNING id, city_id
      )
      INSERT INTO ad_campaigns (advertiser_id, city_id, status, starts_at, ends_at,
                                headline_ar, headline_en, headline_de, target_url)
      SELECT adv.id, adv.city_id, ${status}::ad_status,
             now() - interval '30 days',
             now() + (${days} * interval '1 day'),
             -- A creative is required now: a campaign with nothing to show cannot be delivered.
             'مطعم الاختبار', 'Test Restaurant', 'Testrestaurant',
             'https://example.test/ad'
      FROM adv
      RETURNING reference
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no campaign.');

    return row.reference;
  }

  const statusOf = async (reference: string): Promise<string> => {
    const rows = await db.execute<{ status: string }>(sql`
      SELECT status::text AS status FROM ad_campaigns WHERE reference = ${reference}
    `);

    return rows.rows[0]?.status ?? '';
  };

  /**
   * THE assertion, and the one that could never fail before.
   *
   * Watched to fail by restoring `campaign.status === 'expired'` alone: a lapsed campaign is
   * resumed, and impressions nobody paid for start being served.
   */
  it('cannot be resumed once its window has closed', async () => {
    const lapsed = await campaign(-1, 'paused');

    /* The COLUMN still says `paused` — the sweep has not run. That is the whole point. */
    expect(await statusOf(lapsed)).toBe('paused');

    await expect(
      advertising.setStatus(STAFF(staffId), lapsed, { status: 'active' }),
    ).rejects.toMatchObject({ response: { code: ERROR.CAMPAIGN_EXPIRED } });
  });

  /** The control: a campaign still inside its window resumes normally. */
  it('resumes normally while its window is open', async () => {
    const live = await campaign(30, 'paused');

    await advertising.setStatus(STAFF(staffId), live, { status: 'active' });

    expect(await statusOf(live)).toBe('active');
  });

  /** The sweep makes the column agree with the calendar. */
  it('is retired by the sweep', async () => {
    const lapsed = await campaign(-2, 'active');

    await expiry.sweep();

    expect(await statusOf(lapsed)).toBe('expired');
  });

  /**
   * Including a DRAFT whose window has passed.
   *
   * A campaign written for a window that has since closed is expired whether or not anybody
   * activated it — and leaving it as a draft invites somebody to activate it into a closed window.
   */
  it('retires a draft whose window has passed', async () => {
    const stale = await campaign(-5, 'draft');

    await expiry.sweep();

    expect(await statusOf(stale)).toBe('expired');
  });

  /** And leaves alone everything still running. */
  it('leaves a live campaign alone', async () => {
    const live = await campaign(10, 'active');
    const paused = await campaign(10, 'paused');

    await expiry.sweep();

    expect(await statusOf(live)).toBe('active');
    expect(await statusOf(paused)).toBe('paused');
  });

  /**
   * And the screen does not wait an hour to tell the truth.
   *
   * The campaign below lapsed a second ago and the sweep has NOT run. Before the list computed an
   * effective status this read «نشط» about a campaign `setStatus` would refuse to touch.
   */
  it('reads as expired on the console before the sweep has run', async () => {
    const lapsed = await campaign(-1, 'active');

    const page = await advertising.list({ page: 1, limit: 100, actor: STAFF(staffId) });
    const shown = page.items.find((item) => item.reference === lapsed);

    expect(shown, 'the campaign is on the page').toBeDefined();
    expect(shown?.status).toBe('expired');

    /* The control: the column itself is still `active`, so this is the SELECT and not the sweep. */
    expect(await statusOf(lapsed)).toBe('active');
  });
});
