import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ERROR,
  PERMISSIONS as P,
  type PayoutAccountInput,
  type PayoutAccountStatus,
  isMaterialChange,
  last4,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../common/audit/audit.service.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { conflict, notFound } from '../common/errors/app-error.js';
import { assertCanRead, assertCanWrite } from '../rbac/scope.sql.js';
import { requirePartnerId } from '../rbac/ownership.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * A payout account as anybody outside this service is allowed to see it.
 *
 * There is no shape here that carries the account number, and that is the point: Bashar's rule on
 * 2026-09-04 is that the console «should display appropriately masked account details by default
 * and avoid exposing full banking information unnecessarily», and the cheapest way to honour it is
 * to make the full number impossible to reach rather than merely absent from today's callers. The
 * ciphertext is selected by exactly one query in this file — the one that decides whether an edit
 * is material — and it never leaves the method that reads it.
 */
export interface PayoutAccountView {
  readonly id: string;
  readonly method: string;
  readonly accountHolder: string;
  /** Empty for a number too short to mask; never the whole value. */
  readonly last4: string;
  readonly bankName: string | null;
  readonly swiftCode: string | null;
  readonly currency: string;
  readonly isPrimary: boolean;
  readonly status: PayoutAccountStatus;
  /*
    Which DOOR this account came through — the partner's own account, or a member of staff acting
    on their behalf. It is derived by comparing the submitting user against the partner's own user,
    not by testing `submitted_by_user_id` for null.

    That distinction cost a browser run on 2026-09-04. A partner's token carries a `sub` like every
    other token, so "null means the partner typed it" was never true — and the integration test that
    asserted it passed only because its fixture built partner claims with `sub: undefined`, which no
    real request has. A test whose fixture cannot reach the state it describes is worse than no test.

    The actor's ID is deliberately NOT in this payload. The console needs to know which door, not
    which person; the person is in the audit trail, which is where an investigator looks and where
    it is not sitting on a screen beside the bank details.
  */
  readonly submittedByPartner: boolean;
  readonly verifiedAt: string | null;
  readonly verifiedBy: string | null;
  readonly rejectedAt: string | null;
  readonly rejectionReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type AccountRow = {
  id: string;
  partner_id: string;
  method: string;
  account_holder: string;
  account_number_last4: string;
  bank_name: string | null;
  swift_code: string | null;
  currency_code: string;
  is_primary: boolean;
  status: PayoutAccountStatus;
  submitted_by: string | null;
  submitted_by_partner: boolean;
  verified_at: string | null;
  verified_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Where SAFRA sends a partner's money — entered, changed, verified and refused.
 *
 * ## Why this exists at all
 *
 * `partner_payout_accounts` was read in three places and written in NONE. On 2026-09-04 the
 * database held zero rows, and seventy-six payouts had been released or paid with
 * `payout_account_id` NULL — SAFRA had recorded transfers to partners without recording where any
 * of them went. The release path took `?? null` on a lookup that could not succeed.
 *
 * ## Two doors, one lock
 *
 * Bashar's decision, 2026-09-04: «both paths should be supported» — a partner maintains their own
 * details in the portal, and authorised staff can enter or update them on a partner's behalf from
 * the console. Both arrive at the same three methods below, validate against the same schema, and
 * land in the same state. The only difference the system keeps is WHO submitted, because that is
 * the question an investigator asks first.
 *
 * ## Verification is the gate, and editing re-opens it
 *
 * «Every new payout account and every material change must require verification before it becomes
 * eligible for payouts.» So `create` writes `pending`, and `update` writes `pending` again
 * whenever the money would go somewhere different — `isMaterialChange` in `@safra/contracts` is
 * the whole of what "material" means, and it compares the STORED form so that retyping an IBAN
 * with different spacing does not send staff back through an approval that changes nothing.
 *
 * A rejected account is not deleted. The partner corrects it and it returns to `pending`, which
 * keeps one row with one history rather than a graveyard of attempts nobody can tell apart.
 *
 * ## Two actors are RECORDED, and separation is a policy rather than a refusal
 *
 * Every account carries who submitted it and who verified it, and both are audited. That is what
 * makes «the same person entered and approved this» a question anybody can answer afterwards.
 *
 * It is deliberately not enforced here, and that was a correction. A hard refusal was written first
 * — the same member of staff may not verify what they entered — and it defeats the requirement it
 * sits inside: Bashar asked that «authorised staff can also enter or update payout-account details
 * on behalf of the partner … when required», and on a rota where one finance officer is on duty
 * that path would simply not work, with a refusal reading «already reviewed» which is not what
 * happened. A control that blocks the feature it protects, on a schedule nobody can predict, is
 * worse than the exposure.
 *
 * Splitting `PAYOUT_ACCOUNT_MANAGE` from `PAYOUT_ACCOUNT_VERIFY` is what makes the separation
 * EXPRESSIBLE — an organisation with two people can hand out one permission each and get four eyes
 * from the role map, without the platform assuming everybody has two people. Enforcing it in code,
 * behind a setting, is recorded in `docs/FUTURE-WORK.md` as a decision for Bashar rather than one
 * taken here.
 */
@Injectable()
export class PayoutAccountService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly crypto: FieldEncryptionService,
  ) {}

  /**
   * The signed-in partner's own accounts.
   *
   * It takes no partner id. `requirePartnerId` reads the VERIFIED token, so "can this partner see
   * that partner's bank details" is a question this endpoint cannot be asked — the same shape the
   * rest of the portal uses, and the only shape that cannot be got wrong by a caller.
   */
  async listOwn(claims: AccessTokenClaims | undefined): Promise<PayoutAccountView[]> {
    return this.list(requirePartnerId(claims, P.PAYOUT_ACCOUNT_MANAGE_OWN));
  }

  /**
   * The same list for staff, addressed by the partner's public reference.
   *
   * ## Why the city scope is enforced here rather than declared exempt
   *
   * A payout account has no city of its own; the PARTNER does. A member of staff restricted to
   * Damascus has no business reading — still less redirecting — where a Homs partner is paid, and
   * «not in my cities» must answer the same as «does not exist» so the scope cannot be used to
   * enumerate partners elsewhere. `assertCanRead` and `assertCanWrite` differ on exactly one point
   * and it matters here: `read_only` scope may LOOK at the rest of the country and may change
   * nothing, which is the right shape for a finance officer auditing a payout they cannot alter.
   */
  async listForPartner(
    reference: string,
    claims?: AccessTokenClaims,
  ): Promise<PayoutAccountView[]> {
    const partner = await this.partnerOf(reference);

    assertCanRead(claims, partner.city_id);

    return this.list(partner.id);
  }

  /** A partner entering their own details. */
  async createOwn(
    input: PayoutAccountInput,
    claims: AccessTokenClaims | undefined,
  ): Promise<PayoutAccountView> {
    return this.create(
      requirePartnerId(claims, P.PAYOUT_ACCOUNT_MANAGE_OWN),
      input,
      claims,
    );
  }

  /** Staff entering details on a partner's behalf. */
  async createForPartner(
    reference: string,
    input: PayoutAccountInput,
    claims: AccessTokenClaims | undefined,
  ): Promise<PayoutAccountView> {
    const partner = await this.partnerOf(reference);

    assertCanWrite(claims, partner.city_id);

    return this.create(partner.id, input, claims);
  }

  /**
   * A partner correcting their own details.
   *
   * The partner id is a WHERE clause rather than a check afterwards, so an id belonging to another
   * partner answers "not found" — which is what it is, from this caller's position. A refusal that
   * distinguished "not yours" from "not there" would confirm the row exists.
   */
  async updateOwn(
    id: string,
    input: PayoutAccountInput,
    claims: AccessTokenClaims | undefined,
  ): Promise<PayoutAccountView> {
    return this.update(
      id,
      input,
      claims,
      requirePartnerId(claims, P.PAYOUT_ACCOUNT_MANAGE_OWN),
    );
  }

  /** Staff correcting details on a partner's behalf. */
  async updateForPartner(
    id: string,
    input: PayoutAccountInput,
    claims: AccessTokenClaims | undefined,
  ): Promise<PayoutAccountView> {
    await this.assertInScope(id, claims);

    return this.update(id, input, claims, null);
  }

  async removeOwn(id: string, claims: AccessTokenClaims | undefined): Promise<void> {
    return this.remove(id, claims, requirePartnerId(claims, P.PAYOUT_ACCOUNT_MANAGE_OWN));
  }

  async removeForPartner(
    id: string,
    claims: AccessTokenClaims | undefined,
  ): Promise<void> {
    await this.assertInScope(id, claims);

    return this.remove(id, claims, null);
  }

  /**
   * Approving an account, which is the only thing that makes it payable.
   *
   * Verifying also makes it PRIMARY and demotes the partner's other accounts, because "verified"
   * and "the one we pay" have to be the same answer. Two verified accounts with no primary among
   * them would leave the release path picking by `created_at`, which is not a decision anybody
   * made.
   */
  async verify(
    id: string,
    claims: AccessTokenClaims | undefined,
  ): Promise<PayoutAccountView> {
    await this.assertInScope(id, claims);

    const row = await this.require(id, null);

    if (row.status !== 'pending') throw conflict(ERROR.PAYOUT_ACCOUNT_NOT_PENDING);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE partner_payout_accounts
        SET is_primary = false, updated_at = now()
        WHERE partner_id = ${row.partner_id} AND id <> ${id} AND deleted_at IS NULL
      `);
      await tx.execute(sql`
        UPDATE partner_payout_accounts
        SET status = 'verified',
            verified_at = now(),
            verified_by_user_id = ${claims?.sub ?? null},
            rejected_at = NULL,
            rejected_by_user_id = NULL,
            rejection_reason = NULL,
            is_primary = true,
            updated_at = now()
        WHERE id = ${id}
      `);
    });

    await this.record(claims, 'payout_account.verified', id, {
      partnerId: row.partner_id,
      method: row.method,
      last4: row.account_number_last4,
    });

    return this.require(id, null).then(toView);
  }

  /** Refusing an account, with a reason the partner reads and can act on. */
  async reject(
    id: string,
    reason: string,
    claims: AccessTokenClaims | undefined,
  ): Promise<PayoutAccountView> {
    await this.assertInScope(id, claims);

    const row = await this.require(id, null);

    if (row.status !== 'pending') throw conflict(ERROR.PAYOUT_ACCOUNT_NOT_PENDING);

    await this.db.execute(sql`
      UPDATE partner_payout_accounts
      SET status = 'rejected',
          rejected_at = now(),
          rejected_by_user_id = ${claims?.sub ?? null},
          rejection_reason = ${reason},
          verified_at = NULL,
          verified_by_user_id = NULL,
          is_primary = false,
          updated_at = now()
      WHERE id = ${id}
    `);

    await this.record(claims, 'payout_account.rejected', id, {
      partnerId: row.partner_id,
      method: row.method,
      last4: row.account_number_last4,
      reason,
    });

    return this.require(id, null).then(toView);
  }

  /* ── internals ───────────────────────────────────────────────────────────── */

  private async list(partnerId: string): Promise<PayoutAccountView[]> {
    const rows = await this.db.execute<AccountRow>(sql`
      ${SELECT_ACCOUNT}
      WHERE a.partner_id = ${partnerId} AND a.deleted_at IS NULL
      /*
        Newest first after the primary, so a just-added account is never the one that falls off.

        It was created_at ASC, and a browser run found the failure it invites: with the cap
        reached, a partner who added an account got a 201 and a list that did not contain it —
        no error, no explanation, the newest row sorted last and outside the LIMIT. A partner has
        one or two accounts in practice, so the cap is generous; what it must never do is hide the
        row somebody has just created.
      */
      ORDER BY a.is_primary DESC, a.created_at DESC
      LIMIT 20
    `);

    return rows.rows.map(toView);
  }

  private async create(
    partnerId: string,
    input: PayoutAccountInput,
    claims: AccessTokenClaims | undefined,
  ): Promise<PayoutAccountView> {
    const currencyId = await this.currencyIdOf(input.currency);
    const swift = input.swiftCode === '' ? null : (input.swiftCode ?? null);

    const inserted = await this.db.execute<{ id: string }>(sql`
      INSERT INTO partner_payout_accounts
        (partner_id, method, account_holder, account_number_encrypted,
         account_number_last4, bank_name, swift_code, currency_id,
         is_primary, status, submitted_by_user_id)
      VALUES (
        ${partnerId}, ${input.method}, ${input.accountHolder},
        ${this.crypto.encrypt(input.accountNumber)},
        ${last4(input.accountNumber)}, ${input.bankName ?? null}, ${swift}, ${currencyId},
        /*
          Never primary on arrival, whatever else is on file. Primary means "this is where the
          money goes", and an unverified account must not be able to claim that even for the
          moment before somebody looks at it. verify() is what promotes one.
        */
        false, 'pending', ${claims?.sub ?? null}
      )
      RETURNING id
    `);

    const id = inserted.rows[0]!.id;

    await this.record(claims, 'payout_account.added', id, {
      partnerId,
      method: input.method,
      accountHolder: input.accountHolder,
      last4: last4(input.accountNumber),
      bankName: input.bankName ?? null,
      currency: input.currency,
    });

    return this.require(id, null).then(toView);
  }

  private async update(
    id: string,
    input: PayoutAccountInput,
    claims: AccessTokenClaims | undefined,
    partnerId: string | null,
  ): Promise<PayoutAccountView> {
    /*
      The ONE place the ciphertext is decrypted, and the value never leaves this method. It is read
      to answer a single question — "would this edit send the money somewhere else" — because an
      edit that changes nothing must not cost the partner another approval round, and an edit that
      changes the destination must not be able to slip through as cosmetic.
    */
    const current = await this.requireWithSecret(id, partnerId);
    const material = isMaterialChange(
      {
        method: current.method,
        accountHolder: current.account_holder,
        accountNumber: this.crypto.decrypt(current.account_number_encrypted),
        bankName: current.bank_name,
        swiftCode: current.swift_code,
        currency: current.currency_code,
      },
      input,
    );

    const currencyId = await this.currencyIdOf(input.currency);
    const swift = input.swiftCode === '' ? null : (input.swiftCode ?? null);

    /*
      A REJECTED account returns to review on ANY edit, material or not.

      Found in a browser on 2026-09-04, and it was a dead end rather than a detail. The rule was
      «material change → pending, otherwise keep the status», which for a rejected account meant it
      stayed `rejected` while the statement below cleared `rejected_at` and `rejection_reason` — so
      the partner was left looking at «مرفوض» with no reason attached and no control that could
      change it. Resubmitting the same details, which is exactly what somebody does when they
      believe the refusal was a mistake, did nothing at all.

      Editing a rejected account IS the resubmission. `verified` is the only status an edit may
      preserve, and only when nothing about the destination moved.
    */
    const nextStatus =
      material || current.status === 'rejected' ? 'pending' : current.status;
    const staysPrimary = nextStatus === 'verified' && current.is_primary;

    await this.db.execute(sql`
      UPDATE partner_payout_accounts
      SET method = ${input.method},
          account_holder = ${input.accountHolder},
          account_number_encrypted = ${this.crypto.encrypt(input.accountNumber)},
          account_number_last4 = ${last4(input.accountNumber)},
          bank_name = ${input.bankName ?? null},
          swift_code = ${swift},
          currency_id = ${currencyId},
          /*
            A material change drops it back to pending AND strips primary in the same statement.
            Two statements would leave a window in which the account is unverified and still the
            one the release path picks, and that window is exactly the one worth attacking.
          */
          status = ${nextStatus},
          is_primary = ${staysPrimary},
          verified_at = ${nextStatus === 'verified' ? current.verified_at : null},
          verified_by_user_id =
            CASE WHEN ${nextStatus === 'verified'} THEN verified_by_user_id ELSE NULL END,
          rejected_at = NULL,
          rejected_by_user_id = NULL,
          rejection_reason = NULL,
          submitted_by_user_id = ${claims?.sub ?? null},
          updated_at = now()
      WHERE id = ${id}
    `);

    await this.record(claims, 'payout_account.updated', id, {
      partnerId: current.partner_id,
      method: input.method,
      accountHolder: input.accountHolder,
      last4: last4(input.accountNumber),
      bankName: input.bankName ?? null,
      currency: input.currency,
      /* So the trail says whether this edit re-opened verification, without re-deriving it. */
      reverified: material,
    });

    return this.require(id, null).then(toView);
  }

  private async remove(
    id: string,
    claims: AccessTokenClaims | undefined,
    partnerId: string | null,
  ): Promise<void> {
    const row = await this.require(id, partnerId);

    /*
      A scheduled payout points at this row and has not been paid yet. Removing it would leave a
      transfer whose destination the platform can no longer name — the state this whole feature
      exists to make impossible — so the refusal names the payout rather than the row.
    */
    const inUse = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM partner_payouts
      WHERE payout_account_id = ${id} AND status = 'scheduled'
    `);

    if ((inUse.rows[0]?.n ?? 0) > 0) throw conflict(ERROR.PAYOUT_ACCOUNT_IN_USE);

    await this.db.execute(sql`
      UPDATE partner_payout_accounts
      SET deleted_at = now(), is_primary = false, updated_at = now()
      WHERE id = ${id} AND deleted_at IS NULL
    `);

    await this.record(claims, 'payout_account.removed', id, {
      partnerId: row.partner_id,
      method: row.method,
      last4: row.account_number_last4,
    });
  }

  /** Reads a row without its ciphertext, optionally constrained to one partner. */
  private async require(id: string, partnerId: string | null): Promise<AccountRow> {
    const rows = await this.db.execute<AccountRow>(sql`
      ${SELECT_ACCOUNT}
      WHERE a.id = ${id} AND a.deleted_at IS NULL
        ${partnerId === null ? sql`` : sql`AND a.partner_id = ${partnerId}`}
    `);
    const row = rows.rows[0];

    if (!row) throw notFound(ERROR.PAYOUT_ACCOUNT_NOT_FOUND);

    return row;
  }

  /**
   * The row WITH its ciphertext, and named columns rather than `a.*`.
   *
   * Its return type lists exactly what the query selects. It was typed as `AccountRow & {…}` and
   * that was a trap: `AccountRow` carries `submitted_by_partner`, which is DERIVED in the read
   * projection and which `a.*` does not produce — so the type promised a field that would have
   * been `undefined` at runtime for anybody who later read it. Naming the columns makes the
   * promise and the query the same thing.
   */
  private async requireWithSecret(
    id: string,
    partnerId: string | null,
  ): Promise<{
    partner_id: string;
    method: string;
    account_holder: string;
    account_number_encrypted: string;
    bank_name: string | null;
    swift_code: string | null;
    currency_code: string;
    is_primary: boolean;
    status: PayoutAccountStatus;
    verified_at: string | null;
  }> {
    const rows = await this.db.execute<{
      partner_id: string;
      method: string;
      account_holder: string;
      account_number_encrypted: string;
      bank_name: string | null;
      swift_code: string | null;
      currency_code: string;
      is_primary: boolean;
      status: PayoutAccountStatus;
      verified_at: string | null;
    }>(sql`
      SELECT a.partner_id, a.method, a.account_holder, a.account_number_encrypted,
             a.bank_name, a.swift_code, c.code AS currency_code, a.is_primary,
             a.status, a.verified_at
      FROM partner_payout_accounts a
      JOIN currencies c ON c.id = a.currency_id
      WHERE a.id = ${id} AND a.deleted_at IS NULL
        ${partnerId === null ? sql`` : sql`AND a.partner_id = ${partnerId}`}
    `);
    const row = rows.rows[0];

    if (!row) throw notFound(ERROR.PAYOUT_ACCOUNT_NOT_FOUND);

    return row;
  }

  private async partnerOf(
    reference: string,
  ): Promise<{ id: string; city_id: string | null }> {
    const rows = await this.db.execute<{ id: string; city_id: string | null }>(sql`
      SELECT id, city_id FROM partners WHERE reference = ${reference} AND deleted_at IS NULL
    `);
    const partner = rows.rows[0];

    if (!partner) throw notFound(ERROR.PARTNER_NOT_FOUND);

    return partner;
  }

  /**
   * The city an account belongs to, for a staff route addressed by the ACCOUNT rather than the
   * partner — and a refusal when the actor's scope does not reach it.
   *
   * A missing account and one outside the scope both answer «not found», which is the rule: the
   * refusal must not confirm that a row exists somewhere the caller cannot see.
   */
  private async assertInScope(
    id: string,
    claims: AccessTokenClaims | undefined,
  ): Promise<void> {
    const rows = await this.db.execute<{ city_id: string | null }>(sql`
      SELECT p.city_id
      FROM partner_payout_accounts a
      JOIN partners p ON p.id = a.partner_id
      WHERE a.id = ${id} AND a.deleted_at IS NULL AND p.deleted_at IS NULL
    `);
    const row = rows.rows[0];

    if (!row) throw notFound(ERROR.PAYOUT_ACCOUNT_NOT_FOUND);

    assertCanWrite(claims, row.city_id);
  }

  private async currencyIdOf(code: string): Promise<string> {
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM currencies WHERE code = ${code} AND deleted_at IS NULL
    `);
    const id = rows.rows[0]?.id;

    if (!id) throw notFound(ERROR.GEO_CURRENCY_UNKNOWN);

    return id;
  }

  private async record(
    claims: AccessTokenClaims | undefined,
    action: string,
    accountId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      actorUserId: claims?.sub,
      actorRole: claims?.role,
      action,
      subjectType: 'partner_payout_account',
      subjectId: accountId,
      after: payload,
    });
  }
}

/**
 * The projection every read uses, and it does not name `account_number_encrypted`.
 *
 * Written once so that adding a column to the table cannot quietly add the ciphertext to a
 * response: a `SELECT a.*` here would do exactly that, silently, on the day somebody widens the
 * row. The one query that does need it says so in its own name.
 */
const SELECT_ACCOUNT = sql`
  SELECT a.id, a.partner_id, a.method, a.account_holder, a.account_number_last4,
         a.bank_name, a.swift_code, c.code AS currency_code, a.is_primary, a.status,
         a.submitted_by_user_id AS submitted_by, a.verified_at,
         a.verified_by_user_id AS verified_by, a.rejected_at, a.rejection_reason,
         a.created_at, a.updated_at,
         (a.submitted_by_user_id IS NOT NULL AND a.submitted_by_user_id = p.user_id)
           AS submitted_by_partner
  FROM partner_payout_accounts a
  JOIN currencies c ON c.id = a.currency_id
  JOIN partners p ON p.id = a.partner_id
`;

function toView(row: AccountRow): PayoutAccountView {
  return {
    id: row.id,
    method: row.method,
    accountHolder: row.account_holder,
    last4: row.account_number_last4,
    bankName: row.bank_name,
    swiftCode: row.swift_code,
    currency: row.currency_code,
    isPrimary: row.is_primary,
    status: row.status,
    submittedByPartner: row.submitted_by_partner,
    verifiedAt: row.verified_at,
    verifiedBy: row.verified_by,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
