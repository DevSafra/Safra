import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditLogService } from './audit-log.service.js';

/**
 * نشاط هذا الموظف — one person's own actions, on their own record (`O-staff-2`).
 *
 * ## What this is, and what it must never become
 *
 * صفحة الموظف said آخر نشاط had "moved to the member's own record" and nobody had built it: the
 * detail payload carried no history and the sentence described an intention. The narrow question —
 * «what has THIS person done» — is what somebody deciding whether a colleague's access is right is
 * actually asking, and neither the platform-wide feed on الموظفون nor سجل التدقيق answers it.
 *
 * It is reached with `staff.manage`. Reading the WHOLE trail is `audit_log.read`, a different
 * capability — so the one thing this must never become is a door to a customer's or a partner's
 * actions through a staff id. That is why the actor filter is added BESIDE the staff-role
 * predicate rather than instead of it, and why the third test here is the important one.
 *
 * ## Why an id, and not the search that already existed
 *
 * `actorSearch` resolves a typed TERM against `users` and is a reader's guess. An identity the
 * screen already holds must not go through a name match: two colleagues called أحمد would each
 * read the other's work on their own page. The fourth test plants exactly that pair.
 *
 * Every assertion here was watched to fail against a mutation that dropped the filter.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** `limit` and `page` are required — the schema defaults them for real callers. */
const PAGE = { limit: 25, page: 1 } as const;

const SUBJECT = '99990000-0000-0000-0000-0000000000f1';
const COLLEAGUE = '99990000-0000-0000-0000-0000000000f2';
const NAMESAKE = '99990000-0000-0000-0000-0000000000f3';
/** A staff id that ALSO acted as a customer — the row this screen must not hand over. */
const DOUBLE_LIFE = '99990000-0000-0000-0000-0000000000f4';

describeIfDb('one staff member’s own activity', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: AuditLogService;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    service = new AuditLogService(db);

    /* Two colleagues share a name, so a filter that fell back to matching one would be caught. */
    await db.execute(sql`
      INSERT INTO users (id, email, full_name, role, status, password_hash, preferred_locale)
      VALUES (${SUBJECT}::uuid, 'member-activity-subject@safra.test', 'أحمد',
              'operations_manager'::user_role, 'active', 'x', 'ar'),
             (${COLLEAGUE}::uuid, 'member-activity-colleague@safra.test', 'سارة',
              'operations_manager'::user_role, 'active', 'x', 'ar'),
             (${NAMESAKE}::uuid, 'member-activity-namesake@safra.test', 'أحمد',
              'operations_manager'::user_role, 'active', 'x', 'ar'),
             (${DOUBLE_LIFE}::uuid, 'member-activity-double@safra.test', 'ليلى',
              'operations_manager'::user_role, 'active', 'x', 'ar')
      ON CONFLICT DO NOTHING`);

    /*
      One row per person, and one extra for the subject so «only theirs» is not satisfied by a
      query that happens to return a single row. The `customer` row is the security fixture: the
      SAME user id, stamped with a non-staff role, which is what an account that was a customer
      before it was staff leaves behind.
    */
    await db.execute(sql`
      INSERT INTO audit_log (actor_user_id, actor_role, action, subject_type, subject_id)
      VALUES (${SUBJECT}::uuid,     'operations_manager'::user_role, 'setting.updated',
              'setting', ${SUBJECT}::uuid),
             (${SUBJECT}::uuid,     'operations_manager'::user_role, 'booking.cancelled',
              'booking', ${SUBJECT}::uuid),
             (${COLLEAGUE}::uuid,   'operations_manager'::user_role, 'setting.updated',
              'setting', ${COLLEAGUE}::uuid),
             (${NAMESAKE}::uuid,    'operations_manager'::user_role, 'setting.updated',
              'setting', ${NAMESAKE}::uuid),
             (${DOUBLE_LIFE}::uuid, 'customer'::user_role,           'booking.cancelled',
              'booking', ${DOUBLE_LIFE}::uuid)`);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  it('returns this person’s rows', async () => {
    const page = await service.staffActivity({ ...PAGE, actorUserId: SUBJECT });

    expect(page.items.length, 'both of the subject’s rows').toBe(2);
    expect(page.items.map((entry) => entry.action).sort()).toEqual([
      'booking.cancelled',
      'setting.updated',
    ]);
  });

  /**
   * The negative half, and the one that makes the positive half mean anything.
   *
   * «Withheld» is indistinguishable from «absent» without a control that the colleague's row
   * EXISTS and is reachable — so this asserts both directions in one test rather than trusting
   * that a row nobody can see was ever written.
   */
  it('withholds a colleague’s rows, which the unfiltered list still shows', async () => {
    const mine = await service.staffActivity({ ...PAGE, actorUserId: SUBJECT });

    /*
      `subjectId`, not `subject.id`. The first version of this line read `entry.subject?.id` — and
      `AuditSubject` carries `type`, `reference`, `label` and `href` and NO id, so it was always
      `undefined` and the comparison was always false. It reported coverage and checked nothing; the
      typecheck is what found it, after the test had passed.
    */
    expect(mine.items.some((entry) => entry.subjectId === COLLEAGUE)).toBe(false);

    const theirs = await service.staffActivity({ ...PAGE, actorUserId: COLLEAGUE });

    expect(theirs.items.length, 'the colleague’s row is there to be withheld').toBe(1);
    expect(theirs.items[0]?.subjectId, 'and it is the one that was planted').toBe(
      COLLEAGUE,
    );
  });

  /**
   * `staff.manage` must not become `audit_log.read`.
   *
   * The staff-role predicate is stamped at write time, so it reads what the actor WAS. An account
   * that acted as a customer and later became staff leaves rows this screen must not surface — and
   * it is reachable by URL, since the id is the one in the address bar.
   */
  it('never surfaces what that account did as a CUSTOMER', async () => {
    const page = await service.staffActivity({ ...PAGE, actorUserId: DOUBLE_LIFE });

    expect(page.items, 'a staff id is not a key to its customer history').toEqual([]);
    expect(page.total).toBe(0);
  });

  /**
   * An identity, not a name: a namesake's work is not this person's work.
   *
   * Asserted over EVERY row's actor rather than by naming the namesake's own row. The first
   * version asked whether one specific row was absent, and it stayed green against a mutation that
   * dropped the filter entirely — because the unfiltered page is the newest twenty-five rows of an
   * audit log with thousands in it, and the row it named was simply not on that page. A test whose
   * fixture cannot reach the thing it protects reports coverage and checks nothing.
   */
  it('does not confuse two colleagues who share a name', async () => {
    const page = await service.staffActivity({ ...PAGE, actorUserId: SUBJECT });

    expect(page.items.length).toBeGreaterThan(0);
    expect(
      page.items.map((entry) => entry.actorEmail),
      'every row belongs to the person whose page this is',
    ).toEqual(page.items.map(() => 'member-activity-subject@safra.test'));
  });

  /** An id that names nobody is an empty page, never the unfiltered list. */
  it('answers an id that has done nothing with nothing', async () => {
    const page = await service.staffActivity({
      ...PAGE,
      actorUserId: '00000000-0000-7000-8000-000000000000',
    });

    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });
});
