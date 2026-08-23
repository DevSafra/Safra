import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { PartnerContractService } from './partner-contract.service.js';
import { PartnerContractReadService } from '../partner/partner-contracts.controller.js';
import { SettingsService } from '../settings/settings.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import type { Env } from '../config/env.js';
import type { MailService } from '../mail/mail.service.js';
import type { StorageService } from '../storage/storage.service.js';

/**
 * The two-sided contract signing flow (Bashar, 2026-08-21).
 *
 * ## What these are actually guarding
 *
 * Signing is on PAPER — electronic signatures are not accepted in Syria — so the platform's job is
 * not to verify a signature. It is to carry the files and **enforce the order**: SAFRA signs, the
 * partner sees it, the partner signs, and only then is there a contract. Every test below is about
 * that order, or about the record it leaves.
 *
 * The order is not a nicety. A partner who can return a "signed" copy of a document SAFRA has not
 * signed has produced a one-sided instrument, and the platform would have recorded it as binding.
 *
 * ## The renderer is not exercised here
 *
 * `generate` launches a headless browser, which is a second-scale operation and a Chromium
 * dependency. These tests insert the contract row directly and drive the transitions, so what is
 * tested is the state machine rather than the printer. Generation is covered by the live
 * walkthrough recorded in the runbook.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** A minimal but genuine PDF: the service checks magic bytes, not the declared type. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF').toString(
  'base64',
);

describeIfDb('contract signing', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  let service: PartnerContractService;
  let stored: Map<string, Buffer>;
  let sent: { to: string; subject: string }[];

  let partnerId = '';
  let partnerReference = '';
  let partnerUserId = '';
  let staffUserId = '';
  let contractId = '';

  const staff = (): AccessTokenClaims =>
    ({ sub: staffUserId, role: 'super_admin' }) as unknown as AccessTokenClaims;
  const partner = (): AccessTokenClaims =>
    ({ sub: partnerUserId, role: 'partner' }) as unknown as AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();

    stored = new Map();
    sent = [];

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
      {
        send: (mail: { to: string; subject: string }) => {
          sent.push({ to: mail.to, subject: mail.subject });

          return Promise.resolve();
        },
      } as unknown as MailService,
      {
        PARTNER_URL: 'https://partner.example',
        ADMIN_URL: 'https://console.example',
      } as Env,
      new SettingsService(db),
    );

    /* One super admin, so the "contract returned" mail has exactly one recipient to count. */
    await db.execute(sql`
      UPDATE users SET status = 'suspended' WHERE role = 'super_admin' AND status = 'active'
    `);

    const made = await db.execute<{
      partner_id: string;
      reference: string;
      partner_user: string;
      staff_user: string;
    }>(sql`
      WITH su AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('csign-staff-' || gen_random_uuid() || '@safra.test', '+963900000300',
                'super_admin', 'active', 'ar')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('csign-partner-' || gen_random_uuid() || '@safra.test', '+963900000301',
                'partner', 'active', 'ar')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, (SELECT id FROM partner_types LIMIT 1), 'Sign Test', 'توقيع',
               (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1), 'x',
               '+963900000301', 'csign-p@safra.test', 'pending'
        FROM pu
        RETURNING id, reference, user_id
      )
      SELECT pa.id AS partner_id, pa.reference, pa.user_id AS partner_user,
             (SELECT id FROM su) AS staff_user
      FROM pa
    `);

    const row = made.rows[0];

    partnerId = row?.partner_id ?? '';
    partnerReference = row?.reference ?? '';
    partnerUserId = row?.partner_user ?? '';
    staffUserId = row?.staff_user ?? '';

    /* A generated contract, inserted directly — see the note on the renderer above. */
    const contract = await db.execute<{ id: string }>(sql`
      INSERT INTO partner_contracts
        (partner_id, kind, status, file_key, file_name, content_type, size_bytes,
         uploaded_by_user_id, document_hash)
      VALUES (${partnerId}::uuid, 'base', 'draft', 'k/original.pdf', 'contract.pdf',
              'application/pdf', 1024, ${staffUserId}::uuid, 'originalhash')
      RETURNING id
    `);

    contractId = contract.rows[0]?.id ?? '';
  });

  afterEach(async () => {
    await harness.rollback();
  });

  const upload = () => ({ content: PDF, fileName: 'signed.pdf' });
  const ctx = { ipAddress: '203.0.113.9', userAgent: 'test' };

  const statusOf = async (): Promise<string> => {
    const rows = await db.execute<{ status: string }>(sql`
      SELECT status::text AS status FROM partner_contracts WHERE id = ${contractId}::uuid
    `);

    return rows.rows[0]?.status ?? '';
  };

  // ── The order ───────────────────────────────────────────────────────────────

  /**
   * THE test. A partner must not be able to return a signed copy of a document SAFRA has not
   * signed — that is a one-sided instrument, and the platform would have filed it as binding.
   */
  it('refuses the partner while the contract is still a draft', async () => {
    await expect(
      service.uploadPartnerSignedCopy(partner(), partnerId, contractId, upload(), ctx),
    ).rejects.toMatchObject({ response: { code: ERROR.CONTRACT_NOT_SIGNABLE } });

    expect(await statusOf()).toBe('draft');
  });

  it('sends the contract to the partner when SAFRA signs', async () => {
    await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);

    expect(await statusOf()).toBe('awaiting_partner_signature');
  });

  it('makes the contract active when the partner returns it', async () => {
    await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
    await service.uploadPartnerSignedCopy(
      partner(),
      partnerId,
      contractId,
      upload(),
      ctx,
    );

    expect(await statusOf()).toBe('active');
  });

  /**
   * The PARTNER cannot sign twice on their own.
   *
   * This asserted the same of SAFRA until 2026-08-23, when Bashar made SAFRA's upload repeatable —
   * so the rule is no longer symmetric and the test says which half survives. The partner's step is
   * handed back deliberately, by `reopenForPartner`: a party that can re-sign at will has not
   * signed anything, and unlike SAFRA the partner cannot see whether the document is right.
   */
  it('refuses a second signature from the partner', async () => {
    await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
    await service.uploadPartnerSignedCopy(
      partner(),
      partnerId,
      contractId,
      upload(),
      ctx,
    );

    await expect(
      service.uploadPartnerSignedCopy(partner(), partnerId, contractId, upload(), ctx),
    ).rejects.toMatchObject({ response: { code: ERROR.CONTRACT_NOT_SIGNABLE } });
  });

  // ── Whose contract it is ────────────────────────────────────────────────────

  /**
   * A partner signing somebody else's contract is answered as NOT FOUND, not as forbidden.
   *
   * A 403 confirms the contract exists, which is the one thing an id-probing caller wants.
   */
  it('hides another partner’s contract behind a not-found', async () => {
    await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);

    const other = await db.execute<{ id: string }>(sql`
      WITH u AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('csign-other-' || gen_random_uuid() || '@safra.test', '+963900000302',
                'partner', 'active')
        RETURNING id
      )
      INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                            address, phone, email)
      SELECT u.id, (SELECT id FROM partner_types LIMIT 1), 'Other', 'آخر',
             (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1), 'x',
             '+963900000302', 'csign-other@safra.test'
      FROM u
      RETURNING id
    `);

    await expect(
      service.uploadPartnerSignedCopy(
        partner(),
        other.rows[0]?.id ?? '',
        contractId,
        upload(),
        ctx,
      ),
    ).rejects.toMatchObject({ response: { code: ERROR.CONTRACT_NOT_FOUND } });
  });

  // ── What is refused as a file ───────────────────────────────────────────────

  /** Magic bytes, not the declared type: a renamed ZIP is not a signed contract. */
  it('refuses anything that is not a PDF', async () => {
    await expect(
      service.uploadSafraSignedCopy(
        staff(),
        contractId,
        { content: Buffer.from('PK not a pdf').toString('base64'), fileName: 'x.pdf' },
        ctx,
      ),
    ).rejects.toMatchObject({ response: { code: ERROR.CONTRACT_PDF_REQUIRED } });
  });

  // ── The record ──────────────────────────────────────────────────────────────

  it('records one signature row per party, tied to the generated original', async () => {
    await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
    await service.uploadPartnerSignedCopy(
      partner(),
      partnerId,
      contractId,
      upload(),
      ctx,
    );

    const rows = await db.execute<{
      party: string;
      uploaded_by: string;
      original_hash: string | null;
      ip_address: string | null;
    }>(sql`
      SELECT party::text AS party, uploaded_by_user_id::text AS uploaded_by,
             original_hash, ip_address
      FROM partner_contract_signatures
      WHERE contract_id = ${contractId}::uuid
      ORDER BY uploaded_at
    `);

    expect(rows.rows.map((r) => r.party)).toEqual(['safra', 'partner']);
    expect(rows.rows[0]?.uploaded_by).toBe(staffUserId);
    expect(rows.rows[1]?.uploaded_by).toBe(partnerUserId);
    /* Which generated version each side signed — the discrepancy this exists to expose. */
    expect(rows.rows.every((r) => r.original_hash === 'originalhash')).toBe(true);
    expect(rows.rows[0]?.ip_address).toBe('203.0.113.9');
  });

  // ── Which document each side actually gets ──────────────────────────────────

  /**
   * THE partner-facing assertion (Bashar, 2026-08-21).
   *
   * The partner's download served `partner_contracts.file_key` — the version SAFRA generated,
   * before anybody touched it. So a partner downloaded a blank contract, signed THAT, and returned
   * it: two documents each carrying one signature, rather than one carrying both. Which is not a
   * countersigned contract, and nothing in the flow would have shown it — every status was right.
   */
  describe('what the partner downloads', () => {
    const reader = () =>
      new PartnerContractReadService(
        db,
        {
          put: () => Promise.resolve({ key: 'x' }),
          get: (key: string) => Promise.resolve(stored.get(key) ?? null),
        } as unknown as StorageService,
        new AuditService(db),
      );

    it('serves SAFRA’s signed copy once SAFRA has signed', async () => {
      stored.set('k/original.pdf', Buffer.from('%PDF-original'));

      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);

      const file = await reader().read(contractId, partnerId, partner());

      /* The scan, not the original — anything else is the bug this exists for. */
      expect(file.body.toString()).not.toContain('original');
      expect(file.fileName).toBe('signed.pdf');
    });

    /** And once both have signed, the newest copy is the one carrying both signatures. */
    it('serves the fully signed copy once the partner has returned it', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
      await service.uploadPartnerSignedCopy(
        partner(),
        partnerId,
        contractId,
        {
          content: Buffer.from('%PDF-both-signatures').toString('base64'),
          fileName: 'both.pdf',
        },
        ctx,
      );

      const file = await reader().read(contractId, partnerId, partner());

      expect(file.body.toString()).toContain('both-signatures');
    });

    /**
     * The fallback, on a contract that HAS no scans.
     *
     * `upload` — the older staff path, where somebody attaches a contract signed outside the
     * platform — writes no `partner_contract_signatures` row, so `COALESCE` has nothing to prefer
     * and must serve the contract's own file.
     */
    it('falls back to the contract’s own file when there are no scans', async () => {
      stored.set('k/legacy.pdf', Buffer.from('%PDF-uploaded-by-staff'));

      const legacy = await db.execute<{ id: string }>(sql`
        INSERT INTO partner_contracts
          (partner_id, kind, status, file_key, file_name, content_type, size_bytes,
           uploaded_by_user_id)
        VALUES (${partnerId}::uuid, 'renewal', 'awaiting_partner_signature', 'k/legacy.pdf',
                'legacy.pdf', 'application/pdf', 20, ${staffUserId}::uuid)
        RETURNING id
      `);

      const file = await reader().read(legacy.rows[0]?.id ?? '', partnerId, partner());

      expect(file.body.toString()).toContain('uploaded-by-staff');
    });
  });

  // ── What the partner is shown at all ────────────────────────────────────────

  /**
   * A partner sees every contract of theirs, superseded ones included (Bashar, 2026-08-21).
   *
   * These were the reverse assertion for a few hours: superseded and draft rows were filtered out
   * of the portal, because four «مُستبدل» rows with four download buttons look like an invitation
   * to sign the wrong paper. Bashar asked for them back — they are the partner's own agreements,
   * and a portal that quietly drops records is worse than one that shows history.
   *
   * Kept as tests rather than deleted, because the reversal has a property worth pinning: a
   * superseded contract is READABLE but not ACTIONABLE. `ContractSigning` renders an upload form
   * only for `awaiting_partner_signature`, and the state machine refuses everything else — so the
   * risk the filter was guarding against is handled by the state machine rather than by hiding.
   */
  describe('what the partner is shown', () => {
    const reader = () =>
      new PartnerContractReadService(
        db,
        {
          get: (key: string) => Promise.resolve(stored.get(key) ?? null),
        } as unknown as StorageService,
        new AuditService(db),
      );

    const insert = (status: string) =>
      db.execute<{ id: string }>(sql`
        INSERT INTO partner_contracts
          (partner_id, kind, status, file_key, file_name, content_type, size_bytes,
           uploaded_by_user_id)
        VALUES (${partnerId}::uuid, 'commission_annex', ${status}::partner_contract_status,
                'k/x.pdf', 'x.pdf', 'application/pdf', 10, ${staffUserId}::uuid)
        RETURNING id
      `);

    it('lists every contract, whatever its state', async () => {
      /* The fixture from `beforeEach` is already a draft. */
      await insert('superseded');
      await insert('active');
      await insert('terminated');

      const statuses = (await reader().list(partnerId)).map((row) => row.status).sort();

      expect(statuses).toEqual(['active', 'draft', 'superseded', 'terminated']);
    });

    /** A superseded contract stays downloadable — it is the partner's own record of it. */
    it('lets the partner fetch a superseded contract', async () => {
      stored.set('k/x.pdf', Buffer.from('%PDF-superseded'));

      const superseded = await insert('superseded');
      const file = await reader().read(
        superseded.rows[0]?.id ?? '',
        partnerId,
        partner(),
      );

      expect(file.body.toString()).toContain('superseded');
    });

    /**
     * THE assertion that makes showing them safe. Readable is not the same as signable: the state
     * machine refuses a signature on anything except `awaiting_partner_signature`, so a partner
     * cannot return a superseded contract however visible it is.
     */
    it('still refuses a signature on a superseded contract', async () => {
      const superseded = await insert('superseded');

      await expect(
        service.uploadPartnerSignedCopy(
          partner(),
          partnerId,
          superseded.rows[0]?.id ?? '',
          upload(),
          ctx,
        ),
      ).rejects.toMatchObject({ response: { code: ERROR.CONTRACT_NOT_SIGNABLE } });
    });
  });

  // ── SAFRA uploading more than once ──────────────────────────────────────────

  /**
   * SAFRA may replace their own signed copy (Bashar, 2026-08-23).
   *
   * The first attempt can be the wrong page, the wrong contract or an unreadable scan. Until this,
   * the only remedy was to regenerate the whole document — throwing the terms away to correct a
   * photograph.
   *
   * The partner is deliberately NOT symmetric: their step is handed back by `reopenForPartner`,
   * because a party that can re-sign at will has not signed anything, and unlike SAFRA the partner
   * is not the one who can see whether the document is right.
   */
  describe('SAFRA re-uploading', () => {
    /** How many countersign audit rows say a partner's signature was invalidated. */
    const countersignedCarryingTheFlag = async (): Promise<number> => {
      const rows = await db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM audit_log
        WHERE subject_id = ${contractId}::uuid
          AND action = 'partner_contract.countersigned'
          AND after->>'invalidatedPartnerSignature' = 'true'
      `);

      return Number(rows.rows[0]?.n ?? '0');
    };

    const liveSafra = async (): Promise<string | undefined> => {
      const rows = await db.execute<{ file_name: string }>(sql`
        SELECT file_name FROM partner_contract_signatures
        WHERE contract_id = ${contractId}::uuid AND party = 'safra' AND superseded_at IS NULL
      `);

      return rows.rows[0]?.file_name;
    };

    it('replaces its own copy while the partner has not signed', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
      await service.uploadSafraSignedCopy(
        staff(),
        contractId,
        { content: PDF, fileName: 'second.pdf' },
        ctx,
      );

      expect(await statusOf()).toBe('awaiting_partner_signature');
      expect(await liveSafra()).toBe('second.pdf');
    });

    it('keeps every attempt on the record, one of them live', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
      await service.uploadSafraSignedCopy(
        staff(),
        contractId,
        { content: PDF, fileName: 'second.pdf' },
        ctx,
      );

      const rows = await db.execute<{ n: string; live: string }>(sql`
        SELECT count(*)::text AS n,
               count(*) FILTER (WHERE superseded_at IS NULL)::text AS live
        FROM partner_contract_signatures
        WHERE contract_id = ${contractId}::uuid AND party = 'safra'
      `);

      expect(rows.rows[0]?.n).toBe('2');
      expect(rows.rows[0]?.live).toBe('1');
    });

    /**
     * THE assertion. The partner signed a specific document; once SAFRA sends a different one,
     * that signature is on a page which is no longer the contract. Leaving it live would show a
     * countersigned agreement whose two signatures are on two different papers.
     */
    it('supersedes the partner’s signature when it replaces a signed contract', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
      await service.uploadPartnerSignedCopy(
        partner(),
        partnerId,
        contractId,
        upload(),
        ctx,
      );
      expect(await statusOf()).toBe('active');

      await service.uploadSafraSignedCopy(
        staff(),
        contractId,
        { content: PDF, fileName: 'corrected.pdf' },
        ctx,
      );

      expect(await statusOf()).toBe('awaiting_partner_signature');

      const live = await db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM partner_contract_signatures
        WHERE contract_id = ${contractId}::uuid AND party = 'partner' AND superseded_at IS NULL
      `);

      expect(live.rows[0]?.n).toBe('0');
    });

    /** And `signed_at` goes with it — the contract is not binding while it waits again. */
    it('clears the signed date when it replaces a signed contract', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
      await service.uploadPartnerSignedCopy(
        partner(),
        partnerId,
        contractId,
        upload(),
        ctx,
      );
      await service.uploadSafraSignedCopy(
        staff(),
        contractId,
        { content: PDF, fileName: 'corrected.pdf' },
        ctx,
      );

      const rows = await db.execute<{ signed: boolean }>(sql`
        SELECT signed_at IS NOT NULL AS signed FROM partner_contracts
        WHERE id = ${contractId}::uuid
      `);

      expect(rows.rows[0]?.signed).toBe(false);
    });

    /** The partner may then sign the corrected document. */
    it('lets the partner sign the replacement', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
      await service.uploadPartnerSignedCopy(
        partner(),
        partnerId,
        contractId,
        upload(),
        ctx,
      );
      await service.uploadSafraSignedCopy(
        staff(),
        contractId,
        { content: PDF, fileName: 'corrected.pdf' },
        ctx,
      );

      await service.uploadPartnerSignedCopy(
        partner(),
        partnerId,
        contractId,
        upload(),
        ctx,
      );

      expect(await statusOf()).toBe('active');
    });

    /** The partner still cannot sign twice on their own — only SAFRA's step is repeatable. */
    it('does not make the partner’s step repeatable', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
      await service.uploadPartnerSignedCopy(
        partner(),
        partnerId,
        contractId,
        upload(),
        ctx,
      );

      await expect(
        service.uploadPartnerSignedCopy(partner(), partnerId, contractId, upload(), ctx),
      ).rejects.toMatchObject({ response: { code: ERROR.CONTRACT_NOT_SIGNABLE } });
    });

    /**
     * The audit row says a signature was INVALIDATED, not merely that the status moved.
     *
     * `active` → `awaiting_partner_signature` reads the same whether the partner had signed and
     * was undone or the state was being corrected, and the difference is the whole question when
     * a contract is disputed.
     */
    it('records the invalidated partner signature in the audit log', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
      await service.uploadPartnerSignedCopy(
        partner(),
        partnerId,
        contractId,
        upload(),
        ctx,
      );
      await service.uploadSafraSignedCopy(
        staff(),
        contractId,
        { content: PDF, fileName: 'corrected.pdf' },
        ctx,
      );

      /*
        Counted, not ordered. Every row this test writes shares one `created_at` — the harness runs
        the whole test inside a single transaction and `now()` is transaction START time — so
        `ORDER BY created_at DESC LIMIT 1` picks an arbitrary row rather than the newest.
      */
      expect(await countersignedCarryingTheFlag()).toBe(1);
    });

    /** And it does NOT claim one when there was nothing to invalidate. */
    it('says nothing about a partner signature when none was live', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
      await service.uploadSafraSignedCopy(
        staff(),
        contractId,
        { content: PDF, fileName: 'second.pdf' },
        ctx,
      );

      expect(await countersignedCarryingTheFlag()).toBe(0);
    });

    /**
     * Two uploads never share a storage key.
     *
     * The key was the millisecond alone; now that this repeats, two in the same millisecond would
     * overwrite the object the earlier signature row still points at — destroying the evidence a
     * superseded row exists to keep, and leaving both rows looking correct.
     */
    it('gives every attempt its own file key', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
      await service.uploadSafraSignedCopy(
        staff(),
        contractId,
        { content: PDF, fileName: 'second.pdf' },
        ctx,
      );

      const rows = await db.execute<{ n: string; distinct: string }>(sql`
        SELECT count(*)::text AS n, count(DISTINCT file_key)::text AS distinct
        FROM partner_contract_signatures WHERE contract_id = ${contractId}::uuid
      `);

      expect(rows.rows[0]?.distinct).toBe(rows.rows[0]?.n);
    });

    /** Every send tells the partner, including a replacement — a silent change is the failure. */
    it('emails the partner on each send', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
      expect(sent).toHaveLength(1);

      await service.uploadSafraSignedCopy(
        staff(),
        contractId,
        { content: PDF, fileName: 'second.pdf' },
        ctx,
      );

      expect(sent).toHaveLength(2);
    });
  });

  // ── What the partner is shown about a replacement ───────────────────────────

  /**
   * The partner's own view of a contract SAFRA replaced (Bashar, 2026-08-23).
   *
   * Until this, a replacement was INVISIBLE to the partner: SAFRA re-uploaded, the partner's
   * signature was superseded, the card quietly went back to «بانتظار توقيعك», and nothing on the
   * screen said their signature no longer stood. Somebody asked to re-sign a document they believe
   * they already signed, with no explanation, concludes the upload failed.
   *
   * These check the DATA the screen is built from, and — just as importantly — what it does not
   * carry.
   */
  describe('the version history the partner sees', () => {
    const reader = (): PartnerContractReadService =>
      new PartnerContractReadService(
        db,
        { get: () => Promise.resolve(null) } as unknown as StorageService,
        new AuditService(db),
      );

    const historyOf = async () => {
      const { contracts } = { contracts: await reader().list(partnerId) };
      const contract = contracts.find((row) => row.id === contractId);

      return contract?.history ?? [];
    };

    it('is empty before anybody has sent a copy', async () => {
      expect(await historyOf()).toEqual([]);
    });

    /** NEWEST FIRST (Bashar, 2026-08-23): the copy being acted on belongs at the top. */
    it('lists the newest copy first', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
      await service.uploadPartnerSignedCopy(
        partner(),
        partnerId,
        contractId,
        upload(),
        ctx,
      );

      expect((await historyOf()).map((event) => event.party)).toEqual([
        'partner',
        'safra',
      ]);
    });

    /** And the live entry is the FIRST one — the property both screens render. */
    it('puts the entry that still stands at the top', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);

      expect((await historyOf())[0]?.superseded).toBe(false);
    });

    /**
     * The date is a DAY, not a timestamp.
     *
     * Cut in the query rather than in either UI: a full stamp would tell a partner the second a
     * staff member acted, which neither screen displays and neither needs. Precision that is not
     * shown should not be sent.
     */
    it('sends the date cut to the day', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);

      const [event] = await historyOf();

      expect(event?.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    /** THE case: the partner can see that their own signature was set aside, and by which step. */
    it('shows the partner’s signature as superseded after SAFRA replaces the contract', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
      await service.uploadPartnerSignedCopy(
        partner(),
        partnerId,
        contractId,
        upload(),
        ctx,
      );
      await service.uploadSafraSignedCopy(
        staff(),
        contractId,
        { content: PDF, fileName: 'corrected.pdf' },
        ctx,
      );

      const history = await historyOf();

      expect(history).toHaveLength(3);
      expect(history.map((event) => [event.party, event.superseded])).toEqual([
        ['safra', false],
        ['partner', true],
        ['safra', true],
      ]);
    });

    /** Exactly one entry stands at a time per side, so "which copy counts" is never ambiguous. */
    it('leaves exactly one live entry after three SAFRA uploads', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);

      const history = await historyOf();

      expect(history).toHaveLength(3);
      expect(history.filter((event) => !event.superseded)).toHaveLength(1);
    });

    /**
     * And it carries THREE fields, never the row's other columns.
     *
     * The signature row sits next to the uploader's user id, their IP address, their user agent,
     * the file hash and the storage key. A partner is owed the fact that a replacement happened —
     * not the staff member who made it, not where they were, and not a handle to the file. This is
     * the assertion that keeps a future "just add the filename" from quietly widening it.
     */
    it('carries only party, date and whether it stands', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);

      const [event] = await historyOf();

      expect(Object.keys(event ?? {}).sort()).toEqual(['at', 'party', 'superseded']);
    });

    /** A partner reads their OWN contracts and nobody else's — the WHERE clause, asserted. */
    it('does not return another partner’s contract', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);

      const strangers = await reader().list('00000000-0000-0000-0000-0000000000ff');

      expect(strangers).toEqual([]);
    });
  });

  // ── One scan, both signatures, filed in the room ────────────────────────────

  /**
   * The in-person path (Bashar, 2026-08-23).
   *
   * Both people sign one sheet across a desk, staff scan it once, and the contract is binding
   * without the partner ever touching the platform. Everything below is about the two properties
   * that makes true: the RECORD says both parties signed one document, and the door is open only
   * while the partner is still being ADDED.
   */
  describe('a jointly signed copy', () => {
    const joint = () => ({ content: PDF, fileName: 'both-signed.pdf' });

    const verificationTo = async (value: string) => {
      await db.execute(
        sql`UPDATE partners SET verification = ${value}::verification_status WHERE id = ${partnerId}::uuid`,
      );
    };

    const signatures = async () => {
      const rows = await db.execute<{
        party: string;
        file_key: string;
        live: boolean;
      }>(sql`
        SELECT party::text, file_key, superseded_at IS NULL AS live
        FROM partner_contract_signatures
        WHERE contract_id = ${contractId}::uuid
        ORDER BY party
      `);

      return rows.rows;
    };

    it('takes the contract straight to active from a draft', async () => {
      await service.uploadJointSignedCopy(staff(), contractId, joint(), ctx);

      expect(await statusOf()).toBe('active');
    });

    /** It NEVER passes through the partner's step — there is no send and no return trip. */
    it('records both parties against one file', async () => {
      await service.uploadJointSignedCopy(staff(), contractId, joint(), ctx);

      const live = (await signatures()).filter((row) => row.live);

      expect(live.map((row) => row.party)).toEqual(['partner', 'safra']);
      expect(new Set(live.map((row) => row.file_key)).size).toBe(1);
    });

    it('sets both the sent and the signed date', async () => {
      await service.uploadJointSignedCopy(staff(), contractId, joint(), ctx);

      const rows = await db.execute<{ sent: boolean; signed: boolean }>(sql`
        SELECT sent_at IS NOT NULL AS sent, signed_at IS NOT NULL AS signed
        FROM partner_contracts WHERE id = ${contractId}::uuid
      `);

      expect(rows.rows[0]).toEqual({ sent: true, signed: true });
    });

    /** Over a contract already in flight: the sheet on the table wins, the rest is history. */
    it('supersedes whatever either side had on file', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
      await service.uploadJointSignedCopy(staff(), contractId, joint(), ctx);

      const all = await signatures();

      expect(all.filter((row) => row.live)).toHaveLength(2);
      expect(all.filter((row) => !row.live)).toHaveLength(1);
    });

    it('sends the partner their countersigned copy, not a request to sign', async () => {
      await service.uploadJointSignedCopy(staff(), contractId, joint(), ctx);

      /* The address is the partner USER's, read back rather than assumed — the fixture generates it. */
      const account = await db.execute<{ email: string }>(sql`
        SELECT u.email FROM partners p JOIN users u ON u.id = p.user_id
        WHERE p.id = ${partnerId}::uuid
      `);

      expect(sent).toHaveLength(1);
      expect(sent[0]?.to).toBe(account.rows[0]?.email);
      /* The awaiting-signature subject would ask them to do a thing the API then refuses. */
      expect(sent[0]?.subject).not.toContain('جاهز لتوقيعك');
    });

    /** The audit row says JOINT — otherwise it reads as a partner signature filed by staff. */
    it('marks the audit row as joint', async () => {
      await service.uploadJointSignedCopy(staff(), contractId, joint(), ctx);

      const rows = await db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM audit_log
        WHERE subject_id = ${contractId}::uuid
          AND action = 'partner_contract.countersigned'
          AND after->>'joint' = 'true'
      `);

      expect(rows.rows[0]?.n).toBe('1');
    });

    // ── The boundary, which is the authorization ──────────────────────────────

    it('is allowed while the partner is under review', async () => {
      await verificationTo('in_review');
      await service.uploadJointSignedCopy(staff(), contractId, joint(), ctx);

      expect(await statusOf()).toBe('active');
    });

    /**
     * THE refusal. Once a partner is live their agreement changes hands the ordinary way, so that
     * each signature is something the signer's own account did — and by then they can, because
     * their invitation has been redeemed.
     */
    it('is refused once the partner is approved', async () => {
      await verificationTo('approved');

      await expect(
        service.uploadJointSignedCopy(staff(), contractId, joint(), ctx),
      ).rejects.toMatchObject({ response: { code: ERROR.CONTRACT_JOINT_NOT_ALLOWED } });
    });

    /**
     * And refused for a REJECTED partner, which a `!== 'approved'` guard would have allowed.
     *
     * Filing a signed partnership agreement for somebody the platform turned down records an
     * agreement with a party we declined to do business with.
     */
    it('is refused for a rejected partner', async () => {
      await verificationTo('rejected');

      await expect(
        service.uploadJointSignedCopy(staff(), contractId, joint(), ctx),
      ).rejects.toMatchObject({ response: { code: ERROR.CONTRACT_JOINT_NOT_ALLOWED } });
    });

    /** A refused attempt writes nothing — not the file rows, not the status. */
    it('leaves no trace when it is refused', async () => {
      await verificationTo('approved');

      await service
        .uploadJointSignedCopy(staff(), contractId, joint(), ctx)
        .catch(() => undefined);

      expect(await signatures()).toEqual([]);
      expect(await statusOf()).toBe('draft');
    });

    it('refuses anything that is not a PDF', async () => {
      await expect(
        service.uploadJointSignedCopy(
          staff(),
          contractId,
          { content: Buffer.from('not a pdf').toString('base64'), fileName: 'x.pdf' },
          ctx,
        ),
      ).rejects.toMatchObject({ response: { code: ERROR.CONTRACT_PDF_REQUIRED } });
    });

    it('answers a contract that does not exist the same as one that is not there', async () => {
      await expect(
        service.uploadJointSignedCopy(
          staff(),
          '00000000-0000-0000-0000-0000000000ee',
          joint(),
          ctx,
        ),
      ).rejects.toMatchObject({ response: { code: ERROR.CONTRACT_NOT_FOUND } });
    });

    /** The partner can fetch the document they signed — the `partner` row is what resolves it. */
    it('leaves the partner able to download the signed contract', async () => {
      await service.uploadJointSignedCopy(staff(), contractId, joint(), ctx);

      const reader = new PartnerContractReadService(
        db,
        {
          get: (key: string) => Promise.resolve(stored.get(key) ?? null),
        } as unknown as StorageService,
        new AuditService(db),
      );

      await expect(reader.read(contractId, partnerId, partner())).resolves.toMatchObject({
        fileName: 'both-signed.pdf',
      });
    });
  });

  // ── Handing the step back ───────────────────────────────────────────────────

  /**
   * Re-opening a signed contract so the partner can upload again (Bashar, 2026-08-21).
   *
   * A partner who sends the wrong scan has no way back on their own — the state machine refuses a
   * second upload, correctly. These cover the way back, and the property that makes it safe: the
   * first attempt is SUPERSEDED, never removed.
   */
  describe('re-opening for the partner', () => {
    const signBoth = async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);
      await service.uploadPartnerSignedCopy(
        partner(),
        partnerId,
        contractId,
        {
          content: Buffer.from('%PDF-wrong-scan').toString('base64'),
          fileName: 'wrong.pdf',
        },
        ctx,
      );
    };

    it('returns the contract to awaiting the partner', async () => {
      await signBoth();
      expect(await statusOf()).toBe('active');

      await service.reopenForPartner(staff(), contractId);

      expect(await statusOf()).toBe('awaiting_partner_signature');
    });

    /** THE assertion. The wrong scan stays as the record that it was sent. */
    it('supersedes the first attempt rather than deleting it', async () => {
      await signBoth();
      await service.reopenForPartner(staff(), contractId);

      const rows = await db.execute<{ n: string; live: string }>(sql`
        SELECT count(*)::text AS n,
               count(*) FILTER (WHERE superseded_at IS NULL)::text AS live
        FROM partner_contract_signatures
        WHERE contract_id = ${contractId}::uuid AND party = 'partner'
      `);

      expect(rows.rows[0]?.n).toBe('1');
      expect(rows.rows[0]?.live).toBe('0');
    });

    /** And the partner can then upload again — the whole point. */
    it('lets the partner upload a second time', async () => {
      await signBoth();
      await service.reopenForPartner(staff(), contractId);

      await service.uploadPartnerSignedCopy(
        partner(),
        partnerId,
        contractId,
        {
          content: Buffer.from('%PDF-corrected').toString('base64'),
          fileName: 'right.pdf',
        },
        ctx,
      );

      expect(await statusOf()).toBe('active');

      /* Two attempts on the record, one of them live. */
      const rows = await db.execute<{ n: string; live: string }>(sql`
        SELECT count(*)::text AS n,
               count(*) FILTER (WHERE superseded_at IS NULL)::text AS live
        FROM partner_contract_signatures
        WHERE contract_id = ${contractId}::uuid AND party = 'partner'
      `);

      expect(rows.rows[0]?.n).toBe('2');
      expect(rows.rows[0]?.live).toBe('1');
    });

    /**
     * After a re-open the partner needs SAFRA's copy back — not the wrong one they just sent, and
     * not the blank original.
     */
    it('serves SAFRA’s copy again while the step is open', async () => {
      await signBoth();
      await service.reopenForPartner(staff(), contractId);

      const reader = new PartnerContractReadService(
        db,
        {
          get: (key: string) => Promise.resolve(stored.get(key) ?? null),
        } as unknown as StorageService,
        new AuditService(db),
      );

      const file = await reader.read(contractId, partnerId, partner());

      expect(file.body.toString()).not.toContain('wrong-scan');
    });

    /** Nothing to hand back before both have signed. */
    it('refuses a contract that is not signed by both', async () => {
      await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);

      await expect(service.reopenForPartner(staff(), contractId)).rejects.toMatchObject({
        response: { code: ERROR.CONTRACT_NOT_REOPENABLE },
      });
    });

    /** And the partner is told, or the step sits open with nobody aware of it. */
    it('emails the partner that they can send it again', async () => {
      await signBoth();
      sent.length = 0;

      await service.reopenForPartner(staff(), contractId);

      expect(sent).toHaveLength(1);
      expect(sent[0]?.subject).toContain(partnerReference);
    });
  });

  // ── The notifications ───────────────────────────────────────────────────────

  it('emails the partner when SAFRA signs, and staff when the partner returns it', async () => {
    await service.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toContain(partnerReference);

    await service.uploadPartnerSignedCopy(
      partner(),
      partnerId,
      contractId,
      upload(),
      ctx,
    );

    expect(sent).toHaveLength(2);
    expect(sent[1]?.subject).toContain(partnerReference);
  });

  /**
   * A mail failure must never cost either party their upload. The contract is signed and stored
   * whether or not an SMTP server answered, and the other side finds it on their own screen.
   */
  it('still records the signature when the mail cannot be sent', async () => {
    const failing = new PartnerContractService(
      db,
      {
        put: (key: string, body: Buffer) => {
          stored.set(key, body);

          return Promise.resolve({ key });
        },
        get: (key: string) => Promise.resolve(stored.get(key) ?? null),
      } as unknown as StorageService,
      new AuditService(db),
      { send: () => Promise.reject(new Error('smtp down')) } as unknown as MailService,
      {
        PARTNER_URL: 'https://partner.example',
        ADMIN_URL: 'https://console.example',
      } as Env,
      new SettingsService(db),
    );

    await failing.uploadSafraSignedCopy(staff(), contractId, upload(), ctx);

    expect(await statusOf()).toBe('awaiting_partner_signature');
  });
});
