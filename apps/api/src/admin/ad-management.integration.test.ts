import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR, campaignCreateSchema } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AdManagementService } from './ad-management.service.js';
import { AdInvoiceService } from './ad-invoice.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import type { FxRateService } from '../fx/fx-rate.service.js';

/**
 * Creating advertisers and campaigns, and the money that follows.
 *
 * ## What is worth asserting
 *
 * The parts where a mistake is expensive and quiet: how many invoices a campaign generates, that
 * they cannot be issued twice, that a `due` invoice is NOT revenue until somebody says it was paid,
 * and that the redirect target can never be something dangerous.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const fxStub = {
  rateToSyp: () => Promise.resolve('13000.00000000'),
  decimalsOf: () => Promise.resolve(2),
} as unknown as FxRateService;

describeIfDb('creating and billing a campaign', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const management = new AdManagementService(db, new AuditService(db));
  const invoices = new AdInvoiceService(
    db,
    new AuditService(db),
    new LedgerService(db),
    fxStub,
  );

  let staffId = '';
  let citySlug = '';

  /** Super admin: unscoped, so a scope refusal is never what these cases are measuring. */
  const STAFF = (sub: string): AccessTokenClaims =>
    ({
      sub,
      role: 'super_admin',
      permissions: ['ad.manage'],
    }) as unknown as AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();

    const made = await db.execute<{ id: string; slug: string }>(sql`
      WITH u AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('adm-' || gen_random_uuid() || '@safra.test', '+963900000140',
                'super_admin', 'active')
        RETURNING id
      )
      SELECT u.id, (SELECT slug FROM cities WHERE deleted_at IS NULL LIMIT 1) AS slug FROM u
    `);

    staffId = made.rows[0]?.id ?? '';
    citySlug = made.rows[0]?.slug ?? '';
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const advertiser = async (): Promise<string> =>
    (
      await management.createAdvertiser(STAFF(staffId), {
        name: 'مطعم الشام',
        kind: 'restaurant',
        citySlug,
      })
    ).reference;

  const campaign = async (over: Record<string, unknown> = {}) =>
    management.createCampaign(STAFF(staffId), {
      advertiserReference: await advertiser(),
      citySlug,
      headlineAr: 'أفضل مشاوي في دمشق',
      headlineEn: 'The best grill in Damascus',
      headlineDe: 'Der beste Grill in Damaskus',
      targetUrl: 'https://example.test/menu',
      billingPeriod: 'monthly',
      startsOn: '2026-09-01',
      endsOn: '2026-12-01',
      ...over,
    });

  /**
   * Three months, monthly billing, three invoices.
   *
   * Issued at creation because a campaign's window is fixed: every period it will ever be billed
   * for is already known, and a job that generates them later is one that can fail silently and
   * leave a month unbilled.
   */
  it('issues one invoice per billing period', async () => {
    const created = await campaign({ priceAmount: '150.00', priceCurrency: 'USD' });

    expect(
      created.invoices,
      '1 Sept → 1 Dec is 91 days: three whole months, with the spare day merged into the last',
    ).toBe(3);

    const rows = await db.execute<{ n: string; total: string }>(sql`
      SELECT count(*)::text AS n, sum(amount)::text AS total
      FROM ad_invoices i
      JOIN ad_campaigns c ON c.id = i.campaign_id
      WHERE c.reference = ${created.reference}
    `);

    expect(rows.rows[0]?.n).toBe('3');
    expect(Number(rows.rows[0]?.total), 'each period at the full price').toBe(450);
  });

  /** A campaign with no price is a goodwill placement, and generates nothing to collect. */
  it('issues nothing for a campaign with no price', async () => {
    const created = await campaign();

    expect(created.invoices).toBe(0);
  });

  /**
   * A price without a currency is refused — the shape «no amount without its currency» forbids.
   *
   * Asserted through the SCHEMA, which is where a caller meets it.
   */
  it('refuses a price with no currency, and a currency with no price', () => {
    const base = {
      advertiserReference: 'ADV-000001',
      citySlug,
      headlineAr: 'مطعم',
      headlineEn: 'Grill',
      headlineDe: 'Grill',
      targetUrl: 'https://example.test',
      billingPeriod: 'monthly',
      startsOn: '2026-09-01',
      endsOn: '2026-10-01',
    };

    expect(
      campaignCreateSchema.safeParse({ ...base, priceAmount: '10.00' }).success,
    ).toBe(false);
    expect(
      campaignCreateSchema.safeParse({ ...base, priceCurrency: 'USD' }).success,
    ).toBe(false);
    /* The control: both together are accepted. */
    expect(
      campaignCreateSchema.safeParse({
        ...base,
        priceAmount: '10.00',
        priceCurrency: 'USD',
      }).success,
    ).toBe(true);
  });

  /**
   * A target that is not http or https is refused.
   *
   * The click endpoint redirects to this column, so `javascript:` would execute in the customer's
   * browser on a SAFRA page. The scheme is the danger; the host deliberately is not restricted,
   * because an advertiser's own site is the entire point.
   */
  it('refuses a dangerous redirect target', () => {
    const base = {
      advertiserReference: 'ADV-000001',
      citySlug,
      headlineAr: 'مطعم',
      headlineEn: 'Grill',
      headlineDe: 'Grill',
      billingPeriod: 'monthly',
      startsOn: '2026-09-01',
      endsOn: '2026-10-01',
    };

    for (const targetUrl of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'not-a-url',
    ]) {
      expect(
        campaignCreateSchema.safeParse({ ...base, targetUrl }).success,
        `«${targetUrl}» must be refused`,
      ).toBe(false);
    }

    /* The control: an ordinary advertiser link goes through. */
    expect(
      campaignCreateSchema.safeParse({ ...base, targetUrl: 'https://mataam.sy/menu' })
        .success,
    ).toBe(true);
  });

  it('refuses an advertiser that does not exist', async () => {
    await expect(
      management.createCampaign(STAFF(staffId), {
        advertiserReference: 'ADV-999999',
        citySlug,
        headlineAr: 'أ',
        headlineEn: 'a',
        headlineDe: 'a',
        targetUrl: 'https://example.test',
        billingPeriod: 'monthly',
        startsOn: '2026-09-01',
        endsOn: '2026-10-01',
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.ADVERTISER_NOT_FOUND } });
  });

  /* ── Billing ─────────────────────────────────────────────────────────────────────────────── */

  /**
   * THE assertion about money: an invoice is not revenue until it is PAID.
   *
   * Posting at issue would put revenue in the books for a campaign nobody funded, and every figure
   * derived from the ledger would carry it.
   */
  it('books nothing until an invoice is paid, then a balanced pair', async () => {
    const created = await campaign({ priceAmount: '150.00', priceCurrency: 'USD' });

    /*
      Scoped to THIS campaign's own legs, by the reference the service writes into `description`.

      This counted every `ad_payment`/`ad_revenue` row in the database and expected zero, which
      passed only while nothing had ever paid an ad invoice — it went red the first time the
      feature was actually driven in a browser. A global count is not an assertion about the
      behaviour under test; it is an assertion about the fixture, and the fixture stopped being
      empty as soon as the thing worked.
    */
    const mine = sql`
      FROM ledger_entries
      WHERE account IN ('ad_payment', 'ad_revenue')
        AND description LIKE ${`%${created.reference}%`}`;

    const before = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n ${mine}
    `);

    expect(before.rows[0]?.n, 'a due invoice is a claim, not revenue').toBe('0');

    const invoice = await db.execute<{ reference: string }>(sql`
      SELECT i.reference FROM ad_invoices i
      JOIN ad_campaigns c ON c.id = i.campaign_id
      WHERE c.reference = ${created.reference}
      ORDER BY i.period_start LIMIT 1
    `);

    const reference = invoice.rows[0]?.reference ?? '';

    await invoices.markPaid(STAFF(staffId), reference, 'حوالة بنكية رقم 4471.');

    const legs = await db.execute<{
      account: string;
      direction: string;
      amount: string;
    }>(sql`
      SELECT account::text, direction::text, amount::text ${mine} ORDER BY account::text
    `);

    expect(legs.rows.map((l) => `${l.account}:${l.direction}`)).toStrictEqual([
      'ad_payment:debit',
      'ad_revenue:credit',
    ]);

    for (const leg of legs.rows) expect(Number(leg.amount)).toBe(150);
  });

  /** Paid twice would post the revenue twice. Only a `due` invoice can be paid. */
  it('refuses to pay an invoice that is not due', async () => {
    const created = await campaign({ priceAmount: '150.00', priceCurrency: 'USD' });

    const invoice = await db.execute<{ reference: string }>(sql`
      SELECT i.reference FROM ad_invoices i
      JOIN ad_campaigns c ON c.id = i.campaign_id
      WHERE c.reference = ${created.reference}
      ORDER BY i.period_start LIMIT 1
    `);

    const reference = invoice.rows[0]?.reference ?? '';

    await invoices.markPaid(STAFF(staffId), reference, 'أول دفعة.');

    await expect(
      invoices.markPaid(STAFF(staffId), reference, 'دفعة مكررة.'),
    ).rejects.toMatchObject({ response: { code: ERROR.AD_INVOICE_NOT_DUE } });
  });

  /** §15: who collected it, how much, and against which campaign. */
  it('audits the payment with its amount and its note', async () => {
    const created = await campaign({ priceAmount: '150.00', priceCurrency: 'USD' });

    const invoice = await db.execute<{ reference: string }>(sql`
      SELECT i.reference FROM ad_invoices i
      JOIN ad_campaigns c ON c.id = i.campaign_id
      WHERE c.reference = ${created.reference} ORDER BY i.period_start LIMIT 1
    `);

    await invoices.markPaid(
      STAFF(staffId),
      invoice.rows[0]?.reference ?? '',
      'حوالة 4471.',
    );

    const entry = await db.execute<{ actor: string; reason: string; after: string }>(sql`
      SELECT actor_user_id::text AS actor, reason, after::text AS after
      FROM audit_log WHERE action = 'ad_invoice.paid' ORDER BY created_at DESC LIMIT 1
    `);

    expect(entry.rows[0]?.actor).toBe(staffId);
    expect(entry.rows[0]?.reason).toContain('4471');
    expect(entry.rows[0]?.after).toContain('150.00');
  });

  /**
   * A regional operator sees their own region's billing and nobody else's — BOTH halves.
   *
   * The second assertion is the one that makes the first mean anything. «Withheld» and «absent»
   * are indistinguishable without a control that the invoice is visible to the right reader: a
   * `list` that returned nothing to everybody would satisfy the refusal on its own.
   */
  it('shows an invoice to its own region and to nobody else', async () => {
    const created = await campaign({ priceAmount: '150.00', priceCurrency: 'USD' });

    const cities = await db.execute<{ id: string }>(sql`
      SELECT id FROM cities WHERE deleted_at IS NULL AND slug <> ${citySlug} LIMIT 1
    `);
    const elsewhere = cities.rows[0]?.id;
    const mine = await db.execute<{ id: string }>(sql`
      SELECT id FROM cities WHERE slug = ${citySlug}
    `);

    /* The fixture has to be able to tell the two apart, or it is measuring nothing. */
    expect(elsewhere, 'a second city exists to be scoped away from').toBeTruthy();

    const scopedTo = (...cityIds: string[]): AccessTokenClaims =>
      ({
        sub: staffId,
        role: 'operations_manager',
        permissions: ['ad.read'],
        scope: { kind: 'cities', cityIds, outside: 'none' },
      }) as unknown as AccessTokenClaims;

    const query = { limit: 25, page: 1, q: created.reference };

    const withheld = await invoices.list({ ...query, actor: scopedTo(elsewhere ?? '') });

    expect(withheld.items).toStrictEqual([]);

    /* The control: the operator whose region it IS still sees it. */
    const shown = await invoices.list({
      ...query,
      actor: scopedTo(mine.rows[0]?.id ?? ''),
    });

    expect(shown.items).toHaveLength(3);
    expect(shown.items[0]?.campaign).toBe(created.reference);
  });

  /**
   * And the write path is gated on the row, not on the list.
   *
   * A caller names a reference directly, so «it did not appear in your list» is not a refusal.
   * `markPaid` re-checks the campaign's city before it posts anything to the ledger.
   */
  it('refuses a payment recorded from outside the campaign’s region', async () => {
    const created = await campaign({ priceAmount: '150.00', priceCurrency: 'USD' });

    const cities = await db.execute<{ id: string }>(sql`
      SELECT id FROM cities WHERE deleted_at IS NULL AND slug <> ${citySlug} LIMIT 1
    `);
    const invoice = await db.execute<{ reference: string }>(sql`
      SELECT i.reference FROM ad_invoices i
      JOIN ad_campaigns c ON c.id = i.campaign_id
      WHERE c.reference = ${created.reference} ORDER BY i.period_start LIMIT 1
    `);

    const reference = invoice.rows[0]?.reference ?? '';
    const outsider = {
      sub: staffId,
      role: 'operations_manager',
      permissions: ['ad.manage'],
      scope: { kind: 'cities', cityIds: [cities.rows[0]?.id ?? ''], outside: 'none' },
    } as unknown as AccessTokenClaims;

    await expect(
      invoices.markPaid(outsider, reference, 'حوالة من خارج النطاق.'),
    ).rejects.toThrow();

    /* Nothing was written on the way to the refusal — the invoice is still collectable. */
    const after = await db.execute<{ status: string }>(sql`
      SELECT status::text AS status FROM ad_invoices WHERE reference = ${reference}
    `);

    expect(after.rows[0]?.status).toBe('due');
  });

  /**
   * The description a campaign carries — written, changed, and taken off again.
   *
   * Bashar (2026-08-31). The case that needs saying is the LAST one: an omitted key leaves the
   * description alone and `null` clears it, and a `coalesce` — which the headlines beside it
   * legitimately use — would make those the same request. An operator could then add a description
   * and never remove one, which is the shape this codebase keeps finding.
   */
  describe('a campaign’s description', () => {
    const descriptionOf = async (reference: string) =>
      (
        await db.execute<{ ar: string | null; en: string | null; de: string | null }>(sql`
          SELECT description_ar AS ar, description_en AS en, description_de AS de
          FROM ad_campaigns WHERE reference = ${reference}
        `)
      ).rows[0];

    it('is optional — a campaign without one is created and stores null', async () => {
      const made = await campaign();

      expect(await descriptionOf(made.reference)).toMatchObject({
        ar: null,
        en: null,
        de: null,
      });
    });

    it('is stored in each language it was written in', async () => {
      const made = await campaign({
        descriptionAr: 'مشاوي على الفحم منذ ١٩٦٠',
        descriptionEn: 'Charcoal grill since 1960',
      });

      expect(await descriptionOf(made.reference)).toMatchObject({
        ar: 'مشاوي على الفحم منذ ١٩٦٠',
        en: 'Charcoal grill since 1960',
        de: null,
      });
    });

    it('leaves an omitted description alone and clears one sent as null', async () => {
      const made = await campaign({
        descriptionAr: 'الأصلي',
        descriptionEn: 'The original',
      });

      /* Only the Arabic named — the English must survive untouched. */
      await management.updateCampaign(STAFF(staffId), made.reference, {
        descriptionAr: null,
      });

      expect(await descriptionOf(made.reference)).toMatchObject({
        ar: null,
        en: 'The original',
      });
    });

    it('changes a description without disturbing the headline', async () => {
      const made = await campaign({ descriptionAr: 'قديم' });

      await management.updateCampaign(STAFF(staffId), made.reference, {
        descriptionAr: 'جديد',
      });

      const row = await db.execute<{ headline: string; ar: string | null }>(sql`
        SELECT headline_ar AS headline, description_ar AS ar
        FROM ad_campaigns WHERE reference = ${made.reference}
      `);

      expect(row.rows[0]).toMatchObject({
        headline: 'أفضل مشاوي في دمشق',
        ar: 'جديد',
      });
    });
  });
});
