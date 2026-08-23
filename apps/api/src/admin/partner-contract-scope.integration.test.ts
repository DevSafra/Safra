import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { codeOf } from '../common/errors/app-error.js';
import { PartnerContractService } from './partner-contract.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import type { Env } from '../config/env.js';
import type { MailService } from '../mail/mail.service.js';
import type { StorageService } from '../storage/storage.service.js';

/**
 * Staff scope reaches the partner CONTRACT stack, which it did not until 2026-08-23.
 *
 * ## What was wrong
 *
 * `scope.sql.ts` warns in its own comment that duplicating the predicate per service is how a
 * scope ends up "enforced on eight resources and forgotten on the ninth". `review.service.ts` was
 * the ninth, fixed on 2026-08-20. `partner-contract.service.ts` was the tenth, and it was never
 * scoped at all: not one of its methods took an actor's scope into account.
 *
 * `partners` is in `SCOPED_RESOURCES`, and a partner contract carries the partner's city through
 * `partner_contracts.partner_id -> partners.city_id`. So a city-scoped operations manager — who
 * holds `PARTNER_CONTRACT_MANAGE` and `PARTNER_CONTRACT_READ` — could:
 *
 *   - list every partner contract in the country, and
 *   - file a JOINT signed copy against any of them, which writes a `partner` signature row for
 *     somebody who never signed anything and puts the agreement in force.
 *
 * The last one is the serious half, and it arrived with the joint path on 2026-08-23: the ordinary
 * two-step flow at least needs the partner's own account to complete it, whereas the joint route
 * produces both signatures from one staff request.
 *
 * ## Scopes are built as CLAIMS
 *
 * `scopeOf` reads `actor.scope` straight off the access token, so a claims object is the whole
 * input — the same construction `review-scope.integration.test.ts` uses, and for the same reason:
 * it keeps the test on the guard rather than on the token issuer.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** A minimal but genuine PDF: the service checks magic bytes, not the declared type. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF').toString(
  'base64',
);

describeIfDb('the partner contract stack honours a city scope', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  let service: PartnerContractService;
  let stored: Map<string, Buffer>;

  let cityA = '';
  let cityB = '';
  let partnerInB = '';
  let referenceInB = '';
  let contractInB = '';
  let staffUserId = '';

  /** Restricted to `cities`, with no access at all outside them. */
  const scopedTo = (...cityIds: string[]): AccessTokenClaims =>
    ({
      sub: staffUserId,
      role: 'operations_manager',
      scope: { kind: 'cities', cityIds, outside: 'none' },
    }) as unknown as AccessTokenClaims;

  /** Restricted, but permitted to READ the rest of the country. */
  const readOnlyOutside = (...cityIds: string[]): AccessTokenClaims =>
    ({
      sub: staffUserId,
      role: 'operations_manager',
      scope: { kind: 'cities', cityIds, outside: 'read_only' },
    }) as unknown as AccessTokenClaims;

  const unscoped = (): AccessTokenClaims =>
    ({ sub: staffUserId, role: 'super_admin' }) as unknown as AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();

    stored = new Map();

    /*
      The generated original, actually present in storage.

      Without the bytes `readFile` throws `CONTRACT_NOT_FOUND` at its final check, which would let a
      SKIPPED scope guard pass as a refusal — the test would go green over the hole it exists to
      find. The download has to be genuinely reachable for a refusal to mean anything.
    */
    stored.set('k/original.pdf', Buffer.from('%PDF-1.4 original'));

    service = new PartnerContractService(
      db,
      {
        put: (key: string, body: Buffer) => {
          stored.set(key, body);

          return Promise.resolve({ key });
        },
        get: (key: string) => Promise.resolve(stored.get(key) ?? null),
      } as unknown as StorageService,
      new AuditService(db),
      { send: () => Promise.resolve() } as unknown as MailService,
      {
        PARTNER_URL: 'https://partner.example',
        ADMIN_URL: 'https://console.example',
      } as Env,
      new SettingsService(db),
    );

    const cities = await db.execute<{ id: string }>(sql`
      SELECT id FROM cities WHERE deleted_at IS NULL ORDER BY id LIMIT 2
    `);

    cityA = cities.rows[0]?.id ?? '';
    cityB = cities.rows[1]?.id ?? '';

    const made = await db.execute<{
      partner_id: string;
      reference: string;
      staff_user: string;
    }>(sql`
      WITH su AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('cscope-staff-' || gen_random_uuid() || '@safra.test', '+963900000400',
                'operations_manager', 'active', 'ar')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('cscope-partner-' || gen_random_uuid() || '@safra.test', '+963900000401',
                'partner', 'active', 'ar')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, (SELECT id FROM partner_types LIMIT 1), 'Scope Test', 'نطاق',
               ${cityB}::uuid, 'x', '+963900000401', 'cscope-p@safra.test', 'pending'
        FROM pu
        RETURNING id, reference
      )
      SELECT pa.id AS partner_id, pa.reference, (SELECT id FROM su) AS staff_user FROM pa
    `);

    partnerInB = made.rows[0]?.partner_id ?? '';
    referenceInB = made.rows[0]?.reference ?? '';
    staffUserId = made.rows[0]?.staff_user ?? '';

    const contract = await db.execute<{ id: string }>(sql`
      INSERT INTO partner_contracts
        (partner_id, kind, status, file_key, file_name, content_type, size_bytes,
         uploaded_by_user_id, document_hash)
      VALUES (${partnerInB}::uuid, 'base', 'draft', 'k/original.pdf', 'contract.pdf',
              'application/pdf', 1024, ${staffUserId}::uuid, 'originalhash')
      RETURNING id
    `);

    contractInB = contract.rows[0]?.id ?? '';
  });

  afterEach(async () => {
    await harness.rollback();
  });

  const upload = () => ({ content: PDF, fileName: 'signed.pdf' });
  const ctx = { ipAddress: '203.0.113.9', userAgent: 'test' };

  /**
   * THE test. The joint route writes a `partner` signature for somebody who never signed, so a
   * manager reaching it outside their cities forges an agreement for a partner they are not
   * responsible for — and the contract is binding the moment it lands.
   */
  it('refuses a joint signed copy for a partner outside the scope', async () => {
    await expect(
      service.uploadJointSignedCopy(scopedTo(cityA), contractInB, upload(), ctx),
    ).rejects.toMatchObject({ response: { code: ERROR.REQUEST_NOT_FOUND } });
  });

  /** `read_only` widens READ only — §8.2's rule is that a write outside scope is always refused. */
  it('refuses a joint signed copy outside the scope even in read_only mode', async () => {
    await expect(
      service.uploadJointSignedCopy(readOnlyOutside(cityA), contractInB, upload(), ctx),
    ).rejects.toMatchObject({ response: { code: ERROR.SCOPE_OUTSIDE } });
  });

  it("refuses SAFRA's signed copy for a partner outside the scope", async () => {
    await expect(
      service.uploadSafraSignedCopy(scopedTo(cityA), contractInB, upload(), ctx),
    ).rejects.toMatchObject({ response: { code: ERROR.REQUEST_NOT_FOUND } });
  });

  it('omits a contract outside the scope from the registry', async () => {
    const rows = await service.list(scopedTo(cityA));

    expect(rows.map((row) => row.id)).not.toContain(contractInB);
  });

  it('omits a contract outside the scope when filtering by that partner', async () => {
    const rows = await service.list(scopedTo(cityA), referenceInB);

    expect(rows).toHaveLength(0);
  });

  /* `read_only` means every row is readable; the filter opens up and the write guard carries it. */
  it('shows a contract outside the scope in read_only mode', async () => {
    const rows = await service.list(readOnlyOutside(cityA), referenceInB);

    expect(rows.map((row) => row.id)).toContain(contractInB);
  });

  it('leaves an unscoped member seeing and signing everything', async () => {
    const rows = await service.list(unscoped(), referenceInB);

    expect(rows.map((row) => row.id)).toContain(contractInB);

    await expect(
      service.uploadJointSignedCopy(unscoped(), contractInB, upload(), ctx),
    ).resolves.toBeDefined();
  });

  it('still lets a manager scoped to the right city do the work', async () => {
    await expect(
      service.uploadJointSignedCopy(scopedTo(cityA, cityB), contractInB, upload(), ctx),
    ).resolves.toBeDefined();
  });

  // ── Every write path, not only the joint one ────────────────────────────────

  /*
    `read_only` is the branch a read predicate cannot cover.

    `scopeFilter` deliberately returns `TRUE` for it, so a fix that only touches the list leaves
    every write wide open while LOOKING scoped — the registry hides nothing and the mutation still
    lands. Each of these is therefore checked against `read_only` specifically, and expects
    `SCOPE_OUTSIDE` rather than a 404: the row is one this member is allowed to SEE, so pretending
    it is absent would be a lie they can immediately disprove.
  */
  const writes: [string, (actor: AccessTokenClaims) => Promise<unknown>][] = [
    [
      'uploadJointSignedCopy',
      (a) => service.uploadJointSignedCopy(a, contractInB, upload(), ctx),
    ],
    [
      'uploadSafraSignedCopy',
      (a) => service.uploadSafraSignedCopy(a, contractInB, upload(), ctx),
    ],
    ['markSigned', (a) => service.markSigned(a, contractInB, '2026-08-23')],
    ['reopenForPartner', (a) => service.reopenForPartner(a, contractInB)],
    ['generate', (a) => service.generate(a, referenceInB, 'base')],
    [
      'upload',
      (a) =>
        service.upload(a, {
          partnerReference: referenceInB,
          kind: 'base',
          fileName: 'x.pdf',
          content: PDF,
        }),
    ],
  ];

  for (const [name, call] of writes) {
    it(`refuses ${name} outside the scope in read_only mode`, async () => {
      await expect(call(readOnlyOutside(cityA))).rejects.toMatchObject({
        response: { code: ERROR.SCOPE_OUTSIDE },
      });
    });

    it(`refuses ${name} outside the scope in none mode`, async () => {
      await expect(call(scopedTo(cityA))).rejects.toMatchObject({
        response: { code: ERROR.REQUEST_NOT_FOUND },
      });
    });
  }

  /*
    The refusal must not depend on the contract's STATE.

    `markSigned` refuses a `draft` with `CONTRACT_NOT_AWAITING_SIGNATURE`, and `reopenForPartner`
    refuses anything but `active`. If either check ran before the scope guard, the two answers would
    differ and an out-of-scope member could read a contract's status off the error code — for any
    contract in the country, one probe each. So the guard has to come first, and this is what says so.
  */
  it('answers the same outside the scope whatever state the contract is in', async () => {
    const draft = await service
      .markSigned(scopedTo(cityA), contractInB, '2026-08-23')
      .catch((error: unknown) => error);

    await db.execute(sql`
      UPDATE partner_contracts SET status = 'awaiting_partner_signature'
      WHERE id = ${contractInB}::uuid
    `);

    const awaiting = await service
      .markSigned(scopedTo(cityA), contractInB, '2026-08-23')
      .catch((error: unknown) => error);

    expect(codeOf(draft)).toBe(ERROR.REQUEST_NOT_FOUND);
    expect(codeOf(awaiting)).toBe(codeOf(draft));
  });

  // ── Reading is the other verb, and it has its own rule ──────────────────────

  it('lets read_only download a contract outside the scope', async () => {
    await expect(
      service.readFile(readOnlyOutside(cityA), contractInB, 'original'),
    ).resolves.toMatchObject({ fileName: 'contract.pdf' });
  });

  it('refuses a download outside the scope in none mode', async () => {
    await expect(
      service.readFile(scopedTo(cityA), contractInB, 'original'),
    ).rejects.toMatchObject({ response: { code: ERROR.REQUEST_NOT_FOUND } });
  });

  /**
   * A soft-deleted partner must not turn the scope guard off.
   *
   * `readFile` resolves the owning city through a query that filters `p.deleted_at IS NULL`, and
   * then guards only `if (owner.rows[0])`. The file lookup that follows does not join `partners` at
   * all — so once the partner is soft-deleted the owner row disappears, the guard is SKIPPED rather
   * than failed, and the download proceeds for anybody at all.
   *
   * A guard written as `if (row) assert(...)` is safe only where the next line throws on `!row`.
   * `upload` and `generate` are shaped that way; this one is not, and the difference is invisible
   * at the call site.
   */
  it('still refuses a download outside the scope when the partner is soft-deleted', async () => {
    await db.execute(sql`
      UPDATE partners SET deleted_at = now() WHERE id = ${partnerInB}::uuid
    `);

    await expect(
      service.readFile(scopedTo(cityA), contractInB, 'original'),
    ).rejects.toMatchObject({ response: { code: ERROR.REQUEST_NOT_FOUND } });
  });
});
