import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, createDatabase, type Database } from '@safra/db';
import { PERMISSIONS as P, payoutAccountInputSchema } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { PayoutAccountService } from './payout-account.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import type { Env } from '../config/env.js';

/**
 * The payout-account lifecycle, against a REAL PostgreSQL.
 *
 * Bashar, 2026-09-04, and every clause of it is a test below:
 *
 *  - both entry paths — the partner in the portal, staff in the console;
 *  - «every new payout account and every material change must require verification»;
 *  - the rejection-and-correction round trip;
 *  - «all changes must be fully audited»;
 *  - masked details, «avoid exposing full banking information unnecessarily».
 *
 * What is worth proving here is not that the service calls the right method — it is that a row
 * lands in `pending` no matter which door it came through, that an edit which moves the money
 * takes verification away again, and that the account number is not in anything this service
 * returns. All four are database facts, and a mocked database would keep asserting them long
 * after they stopped being true.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** A throwaway 32-byte key. These tests encrypt within one run and store nothing that outlives it. */
const TEST_ENV = { FIELD_ENCRYPTION_KEY: 'b'.repeat(64) } as unknown as Env;

const IBAN = 'SY1234567890123456789012';

/**
 * Every string anywhere in a payload, however deeply nested.
 *
 * The project's own rule: «A privacy assertion phrased as "this particular string is absent" only
 * ever protects the string it names.» Walking the whole structure asks the general question, so a
 * value that moves to a different field — or into a nested object nobody thought about — is still
 * caught.
 */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];

  if (Array.isArray(value)) return value.flatMap(strings);

  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(strings);
  }

  return [];
}

describeIfDb('PayoutAccountService', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const crypto = new FieldEncryptionService(TEST_ENV);
  const service = new PayoutAccountService(db, new AuditService(db), crypto);

  const input = {
    method: 'bank_transfer' as const,
    accountHolder: 'Palmyra Hotels',
    accountNumber: IBAN,
    bankName: 'Bank of Syria',
    swiftCode: 'BSYRSYDA',
    currency: 'USD',
  };

  /*
    Two REAL staff users, because four eyes is one of the rules under test and it compares actor
    ids. `audit_log.actor_user_id` is a foreign key besides, so a fabricated actor fails on the
    constraint — which is the audit trail refusing to record a decision nobody made.
  */
  let clerk: AccessTokenClaims;
  let approver: AccessTokenClaims;
  let partnerId = '';
  let partnerUserId = '';
  let reference = '';
  /* A second partner, so "not yours" can be tested rather than assumed. */
  let otherPartnerId = '';
  let otherPartnerUserId = '';

  /**
   * A partner's claims, WITH a `sub` — because a real one always has one.
   *
   * The first version of this helper set `sub: undefined`, and it made two tests pass for a reason
   * that could never happen: the service read `submitted_by_user_id` as null and the console
   * inferred «the partner entered this» from the null. A real partner token carries the owner's
   * user id like every other token, so in a browser every account looked staff-entered — which is
   * what the browser run found and this fixture had made invisible.
   */
  const partnerClaims = (id: string, userId: string): AccessTokenClaims =>
    ({
      sub: userId,
      role: 'partner',
      partnerId: id,
      permissions: [P.PAYOUT_ACCOUNT_MANAGE_OWN],
    }) as unknown as AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();

    const staff = await db.execute<{ id: string }>(sql`
      SELECT id FROM users
      WHERE role IN ('finance_officer', 'super_admin') AND deleted_at IS NULL
      ORDER BY created_at LIMIT 2
    `);

    clerk = {
      sub: staff.rows[0]?.id,
      role: 'finance_officer',
      permissions: [P.PAYOUT_ACCOUNT_MANAGE, P.PAYOUT_ACCOUNT_READ],
    } as AccessTokenClaims;
    approver = {
      sub: staff.rows[1]?.id ?? staff.rows[0]?.id,
      role: 'super_admin',
      permissions: [P.PAYOUT_ACCOUNT_VERIFY],
    } as AccessTokenClaims;

    const made = await db.execute<{ id: string; reference: string; user_id: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM partner_types LIMIT 1) AS partner_type_id
      ), u AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        SELECT 'payacct-test-' || gen_random_uuid() || '@safra.test', '+963900000000',
               'partner', 'active', 'ar'
        FROM generate_series(1, 2)
        RETURNING id
      )
      INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                            address, phone, email, verification)
      SELECT u.id, ref.partner_type_id, 'Payout Acct Test', 'Payout Acct Test', ref.city_id,
             'x', '+963900000000', 'payacct-test-' || gen_random_uuid() || '@safra.test',
             'approved'
      FROM u, ref
      RETURNING id, reference, user_id
    `);

    partnerId = made.rows[0]?.id ?? '';
    partnerUserId = made.rows[0]?.user_id ?? '';
    reference = made.rows[0]?.reference ?? '';
    otherPartnerId = made.rows[1]?.id ?? '';
    otherPartnerUserId = made.rows[1]?.user_id ?? '';
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();

    /* Residue from a run killed between begin and rollback. Swallowed — see the payout suite. */
    const sweep = createDatabase(DATABASE_URL ?? '', 1);

    try {
      await sweep.execute(sql`
        DELETE FROM partner_payout_accounts WHERE partner_id IN (
          SELECT id FROM partners WHERE email LIKE 'payacct-test-%')`);
      await sweep.execute(sql`
        DELETE FROM partners WHERE email LIKE 'payacct-test-%'
          AND NOT EXISTS (SELECT 1 FROM partner_payouts po WHERE po.partner_id = partners.id)`);
      await sweep.execute(sql`
        DELETE FROM users WHERE email LIKE 'payacct-test-%'
          AND NOT EXISTS (SELECT 1 FROM partners p WHERE p.user_id = users.id)`);
    } catch {
      /* Residue is not worth a red suite. */
    } finally {
      await (sweep as unknown as { $client: { end: () => Promise<void> } }).$client.end();
    }
  });

  /* ── Both doors, one state ──────────────────────────────────────────────────── */

  it('lands a partner-entered account in pending, never primary', async () => {
    const created = await service.createOwn(
      input,
      partnerClaims(partnerId, partnerUserId),
    );

    expect(created.status).toBe('pending');
    expect(created.isPrimary).toBe(false);
    /* The console reads THIS to say «أدخلها الشريك», and it is derived, not inferred from a null. */
    expect(created.submittedByPartner).toBe(true);
    expect(created.verifiedAt).toBeNull();
  });

  it('lands a staff-entered account in pending too, and records who typed it', async () => {
    const created = await service.createForPartner(reference, input, clerk);

    expect(created.status).toBe('pending');
    expect(created.isPrimary).toBe(false);
    expect(created.submittedByPartner).toBe(false);
  });

  /**
   * The default is in the COLUMN, not only in the service.
   *
   * A row inserted by a repair script, an import, or a route nobody has written yet must be
   * unpayable. The service can only make that guarantee for the paths it knows about.
   */
  it('defaults a row inserted with no status at all to pending', async () => {
    const row = await db.execute<{ status: string }>(sql`
      INSERT INTO partner_payout_accounts
        (partner_id, method, account_holder, account_number_encrypted, account_number_last4,
         currency_id)
      VALUES (${partnerId}, 'bank_transfer', 'Direct Insert', 'x', '9999',
              (SELECT id FROM currencies WHERE code = 'USD'))
      RETURNING status::text AS status
    `);

    expect(row.rows[0]?.status).toBe('pending');
  });

  /* ── Masking ────────────────────────────────────────────────────────────────── */

  /**
   * The number is not withheld from one field — it is absent from the whole payload.
   *
   * Asserted by walking EVERY string in the response rather than by naming the field it used to be
   * in. A `not.toHaveProperty('accountNumber')` protects only the name it mentions, and the next
   * field to carry the value walks straight around it.
   */
  it('never returns the account number in anything it hands back', async () => {
    const created = await service.createOwn(
      input,
      partnerClaims(partnerId, partnerUserId),
    );
    const listed = await service.listOwn(partnerClaims(partnerId, partnerUserId));
    const forStaff = await service.listForPartner(reference);

    for (const payload of [created, listed, forStaff]) {
      /*
        Every string in the payload, and each one is DECRYPTED before it is judged.

        The first draft compared against `crypto.encrypt(IBAN)` and was worthless: AES-GCM uses a
        random IV, so encrypting the same value twice produces two different ciphertexts and the
        comparison could never match. It passed a mutation that put the stored ciphertext straight
        into the response — a test reporting coverage over a field it could not reach, which is the
        failure mode worse than having no test.

        Asking "does this decrypt to the account number" catches BOTH shapes at once: the plaintext
        leak and the ciphertext leak, under any key name somebody gives it.
      */
      for (const value of strings(payload)) {
        expect(value).not.toContain(IBAN);

        let decrypted: string | null = null;

        try {
          decrypted = crypto.decrypt(value);
        } catch {
          /* Not ciphertext at all — which is the ordinary case for a holder name or a date. */
        }

        expect(decrypted).not.toBe(IBAN);
      }
    }

    /*
      And the KEYS are an allow-list, so a new column added to this table cannot arrive in the
      response by being widened into it. `SELECT a.*` would fail here on the day somebody writes it.
    */
    expect(Object.keys(created).sort()).toEqual(
      [
        'accountHolder',
        'bankName',
        'createdAt',
        'currency',
        'id',
        'isPrimary',
        'last4',
        'method',
        'rejectedAt',
        'rejectionReason',
        'status',
        'submittedByPartner',
        'swiftCode',
        'updatedAt',
        'verifiedAt',
        'verifiedBy',
      ].sort(),
    );
    expect(created.last4).toBe('9012');
  });

  /**
   * The opposite control, without which the assertion above is indistinguishable from "the read
   * returned nothing". The masked details a verifier needs must still be there.
   */
  it('still returns enough to verify an account against the partner’s documents', async () => {
    const created = await service.createOwn(
      input,
      partnerClaims(partnerId, partnerUserId),
    );

    expect(created.accountHolder).toBe('Palmyra Hotels');
    expect(created.bankName).toBe('Bank of Syria');
    expect(created.last4).toBe('9012');
    expect(created.currency).toBe('USD');
  });

  /* ── Verification ───────────────────────────────────────────────────────────── */

  it('verifying makes the account payable and primary', async () => {
    const created = await service.createOwn(
      input,
      partnerClaims(partnerId, partnerUserId),
    );
    const verified = await service.verify(created.id, approver);

    expect(verified.status).toBe('verified');
    expect(verified.isPrimary).toBe(true);
    expect(verified.verifiedAt).not.toBeNull();
    expect(verified.verifiedBy).toBe(approver.sub);
  });

  it('verifying one account demotes the partner’s others', async () => {
    const first = await service.createOwn(input, partnerClaims(partnerId, partnerUserId));

    await service.verify(first.id, approver);

    const second = await service.createOwn(
      { ...input, accountNumber: 'SY9999999999999999999999' },
      partnerClaims(partnerId, partnerUserId),
    );

    await service.verify(second.id, approver);

    const accounts = await service.listOwn(partnerClaims(partnerId, partnerUserId));
    const primary = accounts.filter((one) => one.isPrimary);

    expect(primary).toHaveLength(1);
    expect(primary[0]?.id).toBe(second.id);
  });

  /**
   * The two actors are RECORDED — who entered it and who approved it — and both are audited.
   *
   * A hard refusal was written here first: the same member of staff may not verify what they
   * entered. It was removed, because it defeats the requirement it sits inside. Bashar asked that
   * staff be able to enter details on a partner's behalf «when required», and on a rota where one
   * finance officer is on duty that path would not work at all — with a refusal reading «already
   * reviewed», which is not what happened. Separation stays EXPRESSIBLE through two permissions,
   * and enforcing it behind a setting is recorded in `docs/FUTURE-WORK.md` for Bashar to decide.
   *
   * What this asserts is the part that must hold either way: the trail can answer «did one person
   * do both», because both ids are stored and neither is guessed.
   */
  it('records the submitter and the verifier separately', async () => {
    const created = await service.createForPartner(reference, input, clerk);

    expect(created.submittedByPartner).toBe(false);

    const verified = await service.verify(created.id, approver);

    expect(verified.verifiedBy).toBe(approver.sub);

    const rows = await db.execute<{
      submitted: string | null;
      verified: string | null;
    }>(sql`
      SELECT submitted_by_user_id AS submitted, verified_by_user_id AS verified
      FROM partner_payout_accounts WHERE id = ${created.id}
    `);

    expect(rows.rows[0]?.submitted).toBe(clerk.sub);
    expect(rows.rows[0]?.verified).toBe(approver.sub);
  });

  /** And one person CAN do both, which is the case the removed refusal broke. */
  it('lets one member of staff enter and verify when they are the only one on duty', async () => {
    const created = await service.createForPartner(reference, input, clerk);

    await expect(service.verify(created.id, clerk)).resolves.toMatchObject({
      status: 'verified',
    });
  });

  it('refuses to verify an account that has already been decided', async () => {
    const created = await service.createOwn(
      input,
      partnerClaims(partnerId, partnerUserId),
    );

    await service.verify(created.id, approver);

    await expect(service.verify(created.id, approver)).rejects.toMatchObject({
      response: { code: 'payout_account.not_pending' },
    });
  });

  /* ── Rejection and correction ───────────────────────────────────────────────── */

  it('rejects with a reason the partner can read, and the account is not payable', async () => {
    const created = await service.createOwn(
      input,
      partnerClaims(partnerId, partnerUserId),
    );
    const rejected = await service.reject(
      created.id,
      'اسم صاحب الحساب لا يطابق السجل',
      approver,
    );

    expect(rejected.status).toBe('rejected');
    expect(rejected.isPrimary).toBe(false);
    expect(rejected.rejectionReason).toBe('اسم صاحب الحساب لا يطابق السجل');
    expect(rejected.rejectedAt).not.toBeNull();
  });

  /**
   * The whole round trip, which is the flow Bashar asked to see verified end to end: the partner
   * corrects the thing that was wrong and it goes back for review, on ONE row with ONE history
   * rather than a graveyard of attempts nobody can tell apart.
   */
  it('a rejected account returns to pending when the partner corrects it', async () => {
    const created = await service.createOwn(
      input,
      partnerClaims(partnerId, partnerUserId),
    );

    await service.reject(created.id, 'اسم صاحب الحساب لا يطابق السجل', approver);

    const corrected = await service.updateOwn(
      created.id,
      { ...input, accountHolder: 'Palmyra Hotels LLC' },
      partnerClaims(partnerId, partnerUserId),
    );

    expect(corrected.status).toBe('pending');
    expect(corrected.rejectionReason).toBeNull();
    expect(corrected.rejectedAt).toBeNull();

    const verified = await service.verify(created.id, approver);

    expect(verified.status).toBe('verified');
    expect(verified.accountHolder).toBe('Palmyra Hotels LLC');
  });

  /**
   * Resubmitting a rejected account UNCHANGED still sends it back for review.
   *
   * Found in a browser, not here: the original rule kept the status on a non-material edit, so a
   * rejected account stayed rejected while the same statement cleared its reason — «مرفوض» with
   * nothing attached and no way out. Somebody who believes a refusal was a mistake resubmits
   * exactly what they sent, and that has to mean something.
   */
  it('a rejected account returns to review even when nothing is changed', async () => {
    const created = await service.createOwn(
      input,
      partnerClaims(partnerId, partnerUserId),
    );

    await service.reject(created.id, 'الاسم لا يطابق السجل التجاري', approver);

    const resubmitted = await service.updateOwn(
      created.id,
      input,
      partnerClaims(partnerId, partnerUserId),
    );

    expect(resubmitted.status).toBe('pending');
    expect(resubmitted.rejectionReason).toBeNull();
    expect(resubmitted.rejectedAt).toBeNull();
  });

  /**
   * And a REJECTED account is never left claiming a reason it no longer has.
   *
   * The state that broke was self-contradictory rather than merely unhelpful: status `rejected`,
   * `rejection_reason` NULL. Asserted as an invariant over every status, so a future edit to this
   * statement cannot reintroduce it in some other combination.
   */
  it('never leaves a status and its evidence disagreeing', async () => {
    const created = await service.createOwn(
      input,
      partnerClaims(partnerId, partnerUserId),
    );

    for (const act of [
      () => service.reject(created.id, 'سبب كافٍ للرفض', approver),
      () => service.updateOwn(created.id, input, partnerClaims(partnerId, partnerUserId)),
      () => service.verify(created.id, approver),
      () =>
        service.updateOwn(
          created.id,
          { ...input, bankName: 'Another Bank' },
          partnerClaims(partnerId, partnerUserId),
        ),
    ]) {
      const after = await act();

      if (after.status === 'rejected') {
        expect(after.rejectionReason, 'a rejection must carry its reason').not.toBeNull();
        expect(after.rejectedAt).not.toBeNull();
      }

      if (after.status === 'verified') {
        expect(after.verifiedAt, 'a verified account must say when').not.toBeNull();
      }

      if (after.status === 'pending') {
        expect(after.verifiedAt, 'pending is not verified').toBeNull();
        expect(after.rejectionReason, 'pending is not rejected').toBeNull();
        expect(after.isPrimary, 'an unverified account is never the one SAFRA pays').toBe(
          false,
        );
      }
    }
  });

  /* ── Material change ────────────────────────────────────────────────────────── */

  it('a changed account number takes verification away again', async () => {
    const created = await service.createOwn(
      input,
      partnerClaims(partnerId, partnerUserId),
    );

    await service.verify(created.id, approver);

    const edited = await service.updateOwn(
      created.id,
      { ...input, accountNumber: 'SY0000000000000000001111' },
      partnerClaims(partnerId, partnerUserId),
    );

    expect(edited.status).toBe('pending');
    /* Primary goes with it, or the release query would still choose an unverified destination. */
    expect(edited.isPrimary).toBe(false);
    expect(edited.verifiedAt).toBeNull();
  });

  it('a changed bank name takes verification away too', async () => {
    const created = await service.createOwn(
      input,
      partnerClaims(partnerId, partnerUserId),
    );

    await service.verify(created.id, approver);

    const edited = await service.updateOwn(
      created.id,
      { ...input, bankName: 'Commercial Bank of Syria' },
      partnerClaims(partnerId, partnerUserId),
    );

    expect(edited.status).toBe('pending');
  });

  /**
   * The opposite control, and the reason `isMaterialChange` compares the STORED form.
   *
   * A partner who retypes their own IBAN with the spaces they read it with has changed nothing.
   * Sending that through verification would cost them a day of payouts and would train staff to
   * approve without reading, which is worse than not checking at all.
   */
  it('retyping the same details with different spacing keeps the verification', async () => {
    const created = await service.createOwn(
      input,
      partnerClaims(partnerId, partnerUserId),
    );

    await service.verify(created.id, approver);

    /*
      Parsed through the SCHEMA, because that is where the spaces come off — the controller's
      `ZodValidationPipe` is the boundary, and the service is entitled to trust what it is given.

      Calling the service with a raw spaced string instead would test a path no partner can reach,
      and it would go red for a reason that is not a defect. That is exactly what the first draft of
      this test did.
    */
    const retyped = payoutAccountInputSchema.parse({
      ...input,
      accountNumber: 'SY12 3456 7890 1234 5678 9012',
    });
    const edited = await service.updateOwn(
      created.id,
      retyped,
      partnerClaims(partnerId, partnerUserId),
    );

    expect(edited.status).toBe('verified');
    expect(edited.isPrimary).toBe(true);
  });

  /* ── Scope: not yours answers the same as not there ─────────────────────────── */

  it('a partner cannot read another partner’s accounts', async () => {
    await service.createOwn(input, partnerClaims(partnerId, partnerUserId));

    const theirs = await service.listOwn(
      partnerClaims(otherPartnerId, otherPartnerUserId),
    );

    expect(theirs).toHaveLength(0);
  });

  it('a partner cannot edit another partner’s account, and is told "not found"', async () => {
    const created = await service.createOwn(
      input,
      partnerClaims(partnerId, partnerUserId),
    );

    await expect(
      service.updateOwn(
        created.id,
        input,
        partnerClaims(otherPartnerId, otherPartnerUserId),
      ),
    ).rejects.toMatchObject({ response: { code: 'payout_account.not_found' } });
  });

  it('a partner cannot remove another partner’s account', async () => {
    const created = await service.createOwn(
      input,
      partnerClaims(partnerId, partnerUserId),
    );

    await expect(
      service.removeOwn(created.id, partnerClaims(otherPartnerId, otherPartnerUserId)),
    ).rejects.toMatchObject({ response: { code: 'payout_account.not_found' } });

    /* And it is still there — a refused delete must not half-delete. */
    const mine = await service.listOwn(partnerClaims(partnerId, partnerUserId));

    expect(mine).toHaveLength(1);
  });

  /* ── Audit ──────────────────────────────────────────────────────────────────── */

  /**
   * «All changes must be fully audited» — every verb, not only the interesting ones.
   *
   * Asserted as a SET of actions against one account, because a test that checked only
   * `payout_account.added` would stay green on the day `remove` stopped recording anything.
   */
  it('writes an audit row for every change to an account', async () => {
    const created = await service.createOwn(
      input,
      partnerClaims(partnerId, partnerUserId),
    );

    await service.updateOwn(
      created.id,
      { ...input, bankName: 'Commercial Bank of Syria' },
      partnerClaims(partnerId, partnerUserId),
    );
    await service.verify(created.id, approver);
    await service.removeForPartner(created.id, clerk);

    const rows = await db.execute<{ action: string }>(sql`
      SELECT action FROM audit_log
      WHERE subject_type = 'partner_payout_account' AND subject_id = ${created.id}
      ORDER BY created_at
    `);

    expect(rows.rows.map((row) => row.action)).toEqual([
      'payout_account.added',
      'payout_account.updated',
      'payout_account.verified',
      'payout_account.removed',
    ]);
  });

  it('records a rejection with its reason in the trail', async () => {
    const created = await service.createOwn(
      input,
      partnerClaims(partnerId, partnerUserId),
    );

    await service.reject(created.id, 'الاسم لا يطابق السجل التجاري', approver);

    const row = await db.execute<{ after: Record<string, unknown> }>(sql`
      SELECT after FROM audit_log
      WHERE subject_id = ${created.id} AND action = 'payout_account.rejected'
    `);

    expect(row.rows[0]?.after['reason']).toBe('الاسم لا يطابق السجل التجاري');
  });

  /**
   * The audit trail must not become the leak the response is not.
   *
   * `after` is rendered on the console's audit screen, so a full account number written there
   * would be exactly the exposure masking exists to prevent — one screen over.
   */
  it('never writes the account number into the audit trail', async () => {
    const created = await service.createOwn(
      input,
      partnerClaims(partnerId, partnerUserId),
    );

    await service.verify(created.id, approver);

    const rows = await db.execute<{ after: unknown }>(sql`
      SELECT after FROM audit_log WHERE subject_id = ${created.id}
    `);

    for (const row of rows.rows) {
      expect(JSON.stringify(row.after)).not.toContain(IBAN);
    }
  });

  /* ── Removal ────────────────────────────────────────────────────────────────── */

  it('refuses to remove an account a scheduled payout is pointed at', async () => {
    const created = await service.createOwn(
      input,
      partnerClaims(partnerId, partnerUserId),
    );

    await service.verify(created.id, approver);
    await db.execute(sql`
      INSERT INTO partner_payouts (partner_id, reference, period_start, period_end,
                                   gross_amount, fine_amount, net_amount, currency_id,
                                   status, payout_account_id, scheduled_for,
                                   released_at, released_by_user_id)
      VALUES (${partnerId}, 'PO-TEST-' || substr(gen_random_uuid()::text, 1, 8),
              current_date - 30, current_date, '100.00', '0.00', '100.00',
              (SELECT id FROM currencies WHERE code = 'USD'),
              'scheduled', ${created.id}, current_date + 1, now(), ${clerk.sub ?? null})
    `);

    await expect(service.removeForPartner(created.id, clerk)).rejects.toMatchObject({
      response: { code: 'payout_account.in_use' },
    });
  });
});
