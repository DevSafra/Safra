import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import type {
  PageQuery,
  PartnerVerifyInput,
  PropertyReviewInput,
} from '@safra/contracts';
import {
  DEFAULT_SANCTIONS_POLICY,
  SANCTIONS_POLICY_SETTING,
  isSanctionsPolicy,
  type SanctionsPolicy,
} from '@safra/contracts';

import { actorName } from '../common/actor-name.sql.js';
import { AuditService } from '../common/audit/audit.service.js';
import { SanctionsService } from '../sanctions/sanctions.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { MailService } from '../mail/mail.service.js';
import { partnerApprovedMail } from '../mail/mail.templates.js';
import { ENV, type Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import {
  COUNT_CAP,
  ERROR,
  SLA_EXPIRY_WARNING_MINUTES,
  offsetPage,
} from '@safra/contracts';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';
import { describeError } from '../common/errors/safe-error.js';
import { hasRequiredDocuments } from '../partner/required-documents.js';
import {
  assertCanRead,
  assertCanWrite,
  scopeCondition,
  scopeFilter,
} from '../rbac/scope.sql.js';

/**
 * Staff verification of partners and listings (SRS §8.1, §9.2).
 *
 * This is where principle P-002 — "trust before volume" — stops being a slogan.
 * Nothing reaches search without passing through here, and every decision is
 * recorded with who made it, when, and why.
 */
@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly sanctions: SanctionsService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * How hard sanctions screening bites right now.
   *
   * One reader, so the fallback for an absent or mistyped row is decided in one place. An
   * unreadable value resolves to `DEFAULT_SANCTIONS_POLICY` rather than to the strictest option
   * on purpose: `settings` is hand-editable, and a typo that silently made the platform stricter
   * would present as onboarding mysteriously stopping, with nothing on any screen to explain it.
   */
  /**
   * §8.1's precondition for activating a partner account.
   *
   * The RULE itself lives in `required-documents.ts`, because the completion notice on the partner
   * side has to answer the same question and two copies would drift — see the note there.
   */
  private async assertDocumentsOnFile(partnerId: string): Promise<void> {
    if (!(await hasRequiredDocuments(this.db, partnerId))) {
      throw conflict(ERROR.PARTNER_DOCUMENTS_MISSING);
    }
  }

  private async sanctionsPolicy(): Promise<SanctionsPolicy> {
    const raw = await this.settings.get<unknown>(
      SANCTIONS_POLICY_SETTING,
      DEFAULT_SANCTIONS_POLICY,
    );

    return isSanctionsPolicy(raw) ? raw : DEFAULT_SANCTIONS_POLICY;
  }

  /**
   * §9.2's "properties awaiting approval" queue, oldest first so nothing rots.
   *
   * PAGED since 2026-08-20 — see `pendingPartners` for what the unpaged version cost.
   */
  async pendingProperties(query: PageQuery, actor?: AccessTokenClaims) {
    /*
      ONE predicate, used by the page and by the count.

      The house rule is "a count and its list must share one `FROM … WHERE` fragment", and the
      relational query builder has no fragment to share — so the shared thing is this variable. A
      second predicate written out for the count is the drift the rule exists to prevent: «٥٢٧» over
      a list that runs out at fifty is worse than no total at all.
    */
    const where = and(
      eq(schema.properties.status, 'pending_review'),
      isNull(schema.properties.deletedAt),
      /* Staff scope, as a drizzle condition — see `scopeCondition`. */
      scopeCondition(actor, schema.properties.cityId),
    );

    const [items, counted] = await Promise.all([
      this.db.query.properties.findMany({
        where,
        columns: {
          reference: true,
          slug: true,
          nameAr: true,
          nameEn: true,
          address: true,
          latitude: true,
          longitude: true,
          descriptionAr: true,
          createdAt: true,
          reviewNotes: true,
        },
        with: {
          partner: {
            columns: { reference: true, displayName: true, verification: true },
          },
          city: { columns: { slug: true, nameAr: true } },
        },
        orderBy: (p, { asc }) => [asc(p.createdAt)],
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      }),
      /*
        The SAME scope, in the count.

        A count that ignored it would print «٥٢٧ نتيجة» over a list of nothing — the exact drift the
        pagination rule forbids ("a count built from a separately written predicate DRIFTS from the
        list it describes"). The two are different SQL dialects here because the list uses the
        relational builder and the count needs a LIMIT subquery, so the guarantee is a test:
        `review-queues.integration.test.ts` asserts the total equals what a scoped actor can page.
      */
      this.cappedCount(sql`
        SELECT 1 FROM properties
         WHERE status = 'pending_review' AND deleted_at IS NULL
           AND ${scopeFilter(actor, 'city_id')}
      `),
    ]);

    return offsetPage(items, counted, query);
  }

  /**
   * §9.2's "partners awaiting approval".
   *
   * ## Paged since 2026-08-20, and it was not before
   *
   * It took `limit = 50` and the screen rendered whatever came back — no page, no size, no total.
   * With 527 partners awaiting verification, 477 of them were unreachable through the console and
   * nothing on the screen said so, so the queue looked fifty deep. The sidebar badge beside it
   * counted the real figure, which is the shape of the bug: two numbers on one screen, one of them
   * describing a set the reader could not get to.
   *
   * This is a WORK queue, so oldest-first is kept — paging it does not change the order somebody
   * drains it in, it just stops the bottom of the backlog being invisible.
   */
  async pendingPartners(query: PageQuery, actor?: AccessTokenClaims) {
    const where = and(
      eq(schema.partners.verification, 'pending'),
      isNull(schema.partners.deletedAt),
      scopeCondition(actor, schema.partners.cityId),
    );

    const [items, counted] = await Promise.all([
      this.db.query.partners.findMany({
        where,
        columns: {
          reference: true,
          displayName: true,
          legalName: true,
          email: true,
          phone: true,
          verification: true,
          sanctionsScreenedAt: true,
          createdAt: true,
        },
        with: {
          documents: { columns: { kind: true, status: true, fileName: true } },
          city: { columns: { slug: true, nameAr: true } },
        },
        orderBy: (p, { asc }) => [asc(p.createdAt)],
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      }),
      /* The same scope, in the count — see `pendingProperties`. */
      this.cappedCount(sql`
        SELECT 1 FROM partners
         WHERE verification = 'pending' AND deleted_at IS NULL
           AND ${scopeFilter(actor, 'city_id')}
      `),
    ]);

    return offsetPage(items, counted, query);
  }

  /**
   * `count(*)` over a `LIMIT COUNT_CAP + 1` subquery, so the database stops reading.
   *
   * The same shape every registry uses. An uncapped `count(*)` on a queue that grows with the
   * business is unbounded work on every page view, which rule 2 forbids — and past the cap the bar
   * prints «أكثر من ١٠٠٠٠» rather than a figure nobody paid for.
   */
  private async cappedCount(fromWhere: ReturnType<typeof sql>): Promise<number> {
    const rows = await this.db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM (${fromWhere} LIMIT ${COUNT_CAP + 1}) capped`,
    );

    return Number(rows.rows[0]?.n ?? 0);
  }

  /**
   * One listing, everything a reviewer needs to decide (§8.1, P-002).
   *
   * Includes the PARTNER's verification state, which is the thing most likely to make
   * the decision moot: item 116 refuses to publish a listing whose partner is not yet
   * verified, so a reviewer who cannot see that would approve and get a conflict they
   * have no way to explain.
   */
  async propertyDetail(reference: string, actor?: AccessTokenClaims) {
    const property = await this.db.query.properties.findFirst({
      where: and(
        eq(schema.properties.reference, reference),
        isNull(schema.properties.deletedAt),
      ),
      columns: {
        reference: true,
        slug: true,
        nameAr: true,
        nameEn: true,
        descriptionAr: true,
        descriptionEn: true,
        address: true,
        latitude: true,
        longitude: true,
        status: true,
        reviewNotes: true,
        attributes: true,
        createdAt: true,
        /*
          Selected for the SCOPE CHECK and stripped before returning.

          Every admin route keys on the §13.2 reference and deliberately returns no internal uuids,
          so this leaves in the same object it arrived in — see the destructure below.
        */
        cityId: true,
      },
      with: {
        partner: {
          columns: {
            reference: true,
            displayName: true,
            legalName: true,
            verification: true,
          },
        },
        city: { columns: { slug: true, nameAr: true, nameEn: true } },
        propertyType: { columns: { code: true } },
        /**
         * The photos are the review. §5.6's gallery is what a customer sees, and a
         * listing approved without looking at them is the whole of P-002 skipped.
         */
        images: {
          /*
            `variantWidths` as well, so the console can actually SHOW them (§8.1).

            The screen printed a count and a note saying previews were not built yet, which meant a
            reviewer approved a listing they had never seen — while §8.1 says SAFRA verifies a
            property «عبر … الصور». Nothing architectural was missing: `mediaUrl` has been in
            `@safra/session` all along and the customer site renders through it. What was missing
            was this one column in the projection.
          */
          columns: {
            fileKey: true,
            variantWidths: true,
            width: true,
            height: true,
            isCover: true,
          },
        },
        /*
          `nameAr` as well as `nameEn`. The console is Arabic-only and was listing every room by
          its ENGLISH name under an Arabic heading (Bashar, 2026-08-14). Both are sent rather than
          only the Arabic: `units.name_ar` is `NOT NULL`, so the console needs nothing else, but
          this projection is the staff view of a listing under review and the English name is part
          of what is being reviewed.
        */
        units: {
          columns: {
            nameAr: true,
            nameEn: true,
            maxGuests: true,
            basePrice: true,
            minNights: true,
          },
          /*
            The unit's CURRENCY, because «95 / الليلة» is a number nobody can act on.

            SAFRA prices in five currencies and settles in SYP, which differ by four orders of
            magnitude — the standing rule is that no figure a person reads as money appears without
            it. Per UNIT rather than per property: `units.currency_id` is the column the price is
            denominated in, and two units of one property are free to differ.
          */
          with: { currency: { columns: { code: true } } },
        },
      },
    });

    if (!property) throw notFound(ERROR.PROPERTY_NOT_FOUND);

    /*
      Scope, on the ROW, because there is no list to filter.

      `scopeFilter` covers the registries; a detail screen is fetched by reference, so the row
      arrives before it can be refused. That difference is why these two screens went unscoped while
      nine registries did not — the predicate looked like it covered everything. Answers 404 rather
      than 403 under `none`: "not yours" reads the same as "not there".
    */
    assertCanRead(actor, property.cityId);

    /* `cityId` was for the check above; it does not belong in the response. */
    const { cityId: _cityId, ...visible } = property;

    return visible;
  }

  /**
   * Approve or reject a submitted listing.
   *
   * Approval publishes directly rather than stopping at an intermediate `approved`
   * state: the SRS treats verification and going live as one decision, and a
   * listing sitting verified-but-invisible would just be a second queue for staff
   * to forget about.
   */
  async reviewProperty(
    claims: AccessTokenClaims | undefined,
    reference: string,
    input: PropertyReviewInput,
  ) {
    const property = await this.db.query.properties.findFirst({
      where: and(
        eq(schema.properties.reference, reference),
        isNull(schema.properties.deletedAt),
      ),
      columns: { id: true, status: true, partnerId: true, cityId: true },
    });

    if (!property) throw notFound(ERROR.PROPERTY_NOT_FOUND);

    /*
      A WRITE outside scope is refused in BOTH modes.

      `read_only` widens reads and nothing else — "you may look at the rest of the country, you may
      not change it" — so this is `assertCanWrite`, not `assertCanRead`. It was missing entirely
      until 2026-08-20: `assertCanWrite` was called in `dispute.service.ts` and
      `advertising.service.ts` and nowhere else, so a city-scoped operations manager could approve or
      reject a listing anywhere in the country. Nobody is scoped today — every staff row is
      `all_cities` — which is why it had never been reachable, and why the console's scope map would
      have been the feature that exposed it.
    */
    assertCanWrite(claims, property.cityId);

    if (property.status !== 'pending_review') {
      throw conflict(ERROR.PROPERTY_NOT_REVIEWABLE);
    }

    if (input.decision === 'approve') {
      /**
       * The partner must be verified before ANY of their listings can publish.
       *
       * §8.1 requires document verification at the partner level, and approving a
       * property would otherwise quietly bypass it — putting an unvetted operator
       * in front of paying customers, which is precisely what P-002 forbids.
       */
      const partner = await this.db.query.partners.findFirst({
        where: eq(schema.partners.id, property.partnerId),
        columns: { verification: true, reference: true, sanctionsScreenedAt: true },
      });

      if (partner?.verification !== 'approved') {
        throw conflict(ERROR.PARTNER_NOT_VERIFIED);
      }
    }

    const nextStatus = input.decision === 'approve' ? 'published' : 'rejected';

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.properties)
        .set({
          status: nextStatus,
          reviewNotes: input.notes ?? null,
          reviewedAt: new Date(),
          // verifiedAt is set ONLY on approval, and never cleared on rejection —
          // it records that a human checked this listing, which stays true.
          ...(input.decision === 'approve'
            ? { verifiedAt: new Date(), verifiedByUserId: claims?.sub ?? null }
            : {}),
        })
        .where(eq(schema.properties.id, property.id));

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: `property.${input.decision === 'approve' ? 'approved' : 'rejected'}`,
          subjectType: 'property',
          subjectId: property.id,
          before: { status: property.status },
          after: { status: nextStatus },
          reason: input.notes ?? null,
        },
        tx as unknown as Database,
      );

      await tx.insert(schema.timelineEvents).values({
        subjectType: 'property',
        subjectId: property.id,
        eventType: `property.${input.decision === 'approve' ? 'approved' : 'rejected'}`,
        actorType: 'staff',
        actorUserId: claims?.sub ?? null,
        payload: { notes: input.notes ?? null },
      });
    });

    return { reference, status: nextStatus, notes: input.notes ?? null };
  }

  /**
   * One partner, everything a reviewer needs to decide (§8.1).
   *
   * Separate from the queue rather than reusing it: the queue is a list of what is
   * waiting and is capped, while this is the evidence for a single decision — the
   * documents with their individual review state, the screening result, and the
   * listings that will go live the moment this partner is approved.
   *
   * That last one matters and is easy to omit. Approving a partner is not an
   * isolated act; item 116 means their submitted listings become publishable, so a
   * reviewer who cannot see what they are about to unlock is deciding half-blind.
   */
  async partnerDetail(reference: string, actor?: AccessTokenClaims) {
    const partner = await this.db.query.partners.findFirst({
      where: and(
        eq(schema.partners.reference, reference),
        isNull(schema.partners.deletedAt),
      ),
      columns: {
        reference: true,
        legalName: true,
        displayName: true,
        email: true,
        phone: true,
        address: true,
        /*
          §8.1 lists «الموقع على الخريطة» among the registration data a verifier checks. The
          columns existed and nothing read them — lat/lng were surfaced for PROPERTIES only, so
          somebody approving a business could not see where it is.
        */
        latitude: true,
        longitude: true,
        /* For the scope check, stripped before returning — see `propertyDetail`. */
        cityId: true,
        verification: true,
        verifiedAt: true,
        sanctionsScreenedAt: true,
        sanctionsScreeningResult: true,
        suspendedAt: true,
        suspendedReason: true,
        /*
          The staff-facing half of the suspension record (2026-08-24). `suspendedNotes` NEVER
          reaches the partner's own payload — `/partner/me` omits it entirely rather than nulling
          it, because a field with two audiences and one shape is what produced the `actor_name`
          leak this morning.
        */
        suspendedNotes: true,
        suspendedByUserId: true,
        createdAt: true,
      },
      with: {
        city: { columns: { slug: true, nameAr: true, nameEn: true } },
        /*
          `nameAr` alongside the code. The console printed the CODE — «accommodation» beside
          Arabic on the partner screen (Bashar, 2026-08-06) — while the الشركاء registry has
          selected the Arabic name since the same defect was fixed there. The code stays in the
          response because it is the machine identifier; the name is what a person reads.
        */
        partnerType: { columns: { code: true, nameAr: true, nameEn: true } },
        documents: {
          columns: {
            id: true,
            kind: true,
            fileName: true,
            status: true,
            reviewNotes: true,
            reviewedAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!partner) throw notFound(ERROR.PARTNER_NOT_FOUND);

    /* Scope on the row — see `propertyDetail`. */
    assertCanRead(actor, partner.cityId);

    /**
     * Their listings, so the reviewer sees the consequence of approving.
     *
     * A separate query rather than another relation: `properties` is not declared as
     * a relation on `partners`, and adding one to serve a single screen would widen
     * the relational graph for every other query that touches a partner.
     */
    const properties = await this.db.execute<{
      reference: string;
      name_ar: string;
      name_en: string | null;
      status: string;
    }>(sql`
      SELECT reference, name_ar, name_en, status::text AS status
      FROM properties
      WHERE partner_id = (SELECT id FROM partners WHERE reference = ${reference})
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 50
    `);

    /**
     * Whether this partner holds a second factor.
     *
     * A boolean and nothing else. The reviewer needs it to answer "have they enrolled yet" before
     * offering a reset; the secret, the recovery codes and their count are none of the console's
     * business, and selecting them here would put them in a response that has no use for them.
     *
     * A separate query because `users` is not a relation on `partners` in this graph, and the
     * alternative — widening `partnerDetail`'s relation set — would attach a user row to every
     * other caller that wants a partner.
     */
    /*
      §8.1's «بيانات التحويل المالي» — enough to VERIFY, never enough to pay someone else.

      `account_number_encrypted` is deliberately not selected: this screen answers "are the transfer
      details on file, and do they look like the right business", which the holder, the bank and the
      last four settle. A full account number on a verification screen is a credential sitting in
      front of every reader who can open a partner, and nothing here needs it.
    */
    const payoutAccounts = await this.db.execute<{
      method: string;
      account_holder: string;
      account_number_last4: string;
      bank_name: string | null;
    }>(sql`
      SELECT method, account_holder, account_number_last4, bank_name
      FROM partner_payout_accounts
      WHERE partner_id = (SELECT id FROM partners WHERE reference = ${reference})
      ORDER BY created_at
      LIMIT 5
    `);

    const account = await this.db.execute<{
      two_factor_enabled: boolean;
      account_activated: boolean;
      invitation_pending: boolean;
    }>(sql`
      SELECT (u.totp_enabled_at IS NOT NULL) AS two_factor_enabled,
             /*
               Whether the partner can SIGN IN at all (Bashar, 2026-08-23).

               The role is the fact, not the presence of a password: an onboarded partner may be an
               adopted customer account that already had one, and that password signs them into the
               customer site, not the partner portal. The partner role is set by exactly one thing
               — redeeming the invitation — so it is the honest answer to "has this person taken
               possession of the account we made them".

               No backticks in this comment: it sits INSIDE a sql template literal, and a backtick
               here terminates the template. The parse error it produces points at the comment, not
               at the SQL, which is why it costs ten minutes every time.
             */
             (u.role = 'partner') AS account_activated,
             /* A link that is still live. Absent means the only remedy is to send a new one. */
             EXISTS (
               SELECT 1 FROM auth_tokens t
               WHERE t.user_id = u.id
                 AND t.purpose = 'partner_invitation'
                 AND t.consumed_at IS NULL
                 AND t.expires_at > now()
             ) AS invitation_pending
      FROM users u
      JOIN partners p ON p.user_id = u.id
      WHERE p.reference = ${reference}
    `);

    /*
      `cityId` was for the scope check; the raw suspension columns are replaced by one object below.
      Destructured out rather than left alongside it, so a screen cannot render `suspendedReason`
      without the rest and end up telling somebody a business is on hold with no date and no author.
    */
    const {
      cityId: _cityId,
      suspendedAt,
      suspendedReason,
      suspendedNotes,
      suspendedByUserId,
      ...visible
    } = partner;

    /*
      Who suspended, by name — through `actorName`, so a super admin appears as «Admin».

      Third site for that helper today. The first two leaks both went out because a new query
      selected an identifying column and nobody asked whether the pseudonym applied to it.
    */
    const by = suspendedByUserId
      ? await this.db.execute<{ name: string | null }>(sql`
          SELECT ${actorName(sql`u.email`, sql`u.role`)} AS name
          FROM users u WHERE u.id = ${suspendedByUserId}::uuid LIMIT 1
        `)
      : null;

    return {
      ...visible,
      /*
        ONE object, or null. The console's banner states four consequences of a suspension and needs
        the reason, the date and the author together; scattering them across the payload is how a
        screen ends up rendering «موقوف» with nothing a reader can act on.

        `notes` is here and is CONSOLE-ONLY — `/partner/me` omits it entirely.
      */
      suspension: suspendedAt
        ? {
            reason: suspendedReason,
            notes: suspendedNotes,
            since: suspendedAt,
            by: by?.rows[0]?.name ?? null,
          }
        : null,
      /* §8.1 — the transfer details, masked. An empty list means none are on file. */
      payoutAccounts: payoutAccounts.rows.map((row) => ({
        method: row.method,
        accountHolder: row.account_holder,
        last4: row.account_number_last4,
        bankName: row.bank_name,
      })),
      /* No user account behind the partner reads as "not enrolled", which it is. */
      twoFactorEnabled: account.rows[0]?.two_factor_enabled ?? false,
      /*
        Both default FALSE when there is no account row, and that pairing is deliberate: it reads
        as "cannot sign in, and no link is outstanding", which is exactly the state that needs a
        human to do something. Defaulting `accountActivated` true would hide a broken partner.
      */
      accountActivated: account.rows[0]?.account_activated ?? false,
      invitationPending: account.rows[0]?.invitation_pending ?? false,
      properties: properties.rows.map((row) => ({
        reference: row.reference,
        nameAr: row.name_ar,
        nameEn: row.name_en,
        status: row.status,
      })),
    };
  }

  /**
   * Verify or reject a partner (§8.1).
   *
   * Approval requires that sanctions screening has been recorded. That is not
   * bureaucracy: the general Syria sanctions programme was repealed in 2025 but
   * residual SDN designations and export controls survive it, so onboarding an
   * unscreened counterparty is a live legal risk (see ADR 0002).
   */
  async verifyPartner(
    claims: AccessTokenClaims | undefined,
    reference: string,
    input: PartnerVerifyInput,
  ) {
    const partner = await this.db.query.partners.findFirst({
      where: and(
        eq(schema.partners.reference, reference),
        isNull(schema.partners.deletedAt),
      ),
      columns: {
        id: true,
        verification: true,
        sanctionsScreenedAt: true,
        cityId: true,
      },
    });

    if (!partner) throw notFound(ERROR.PARTNER_NOT_FOUND);

    /* A write outside scope is refused in both modes — see `reviewProperty`. */
    assertCanWrite(claims, partner.cityId);

    if (partner.verification === 'approved' && input.decision === 'approve') {
      throw conflict(ERROR.PARTNER_ALREADY_VERIFIED);
    }

    /*
      Screening blocks an approval only while the policy says so (Bashar, 2026-08-21).

      This was an unconditional gate, and it made an external registration — `M-2`, the EU feed
      account — a launch blocker: screening refuses a list older than seven days, so with no feed
      onboarding stopped altogether. The legal obligation it stands for is not "screen at
      approval"; it is the asset-freeze prohibition, which is about where money ends up. See
      `docs/sanctions-screening-review.md` for what was checked.

      Read fresh on every approval rather than cached in this service: the policy is edited from
      the console, and an approval decided under a stale reading would be stamped below with a
      policy that was not actually in force — which is worse than no stamp at all.
    */
    /*
      §8.1 — «يجب رفع وثائق التحقق قبل تفعيل الحساب».

      ## The rule had no enforcement at all

      Approval activates the partner: it is what lets them publish (P-002) and be paid. §8.1 makes
      the verification documents a precondition, and nothing checked for one — a business could be
      approved with an empty document list. Found while reviewing طلبات الانضمام, 2026-08-26.

      ## Two classes, not five documents

      The SRS says «هوية **أو** سجل تجاري» and «إثبات ملكية **أو** عقد إدارة» — one of each pair,
      not both, and it does not name a bank letter as a verification document at all. The stricter
      set that `notifyStaffIfComplete` uses to congratulate a partner is a different question: that
      one is «you have finished», this one is «we may switch you on».

      ## Uploaded and not refused, rather than reviewed and approved
      
      §8.1's word is «رفع». A rejected document is not on file, so it does not count; a document
      awaiting review does. Requiring `approved` would be a stricter rule than the SRS states, and
      the document review has its own screen and its own decision.
      
      Only on APPROVE. A rejection needs no paperwork, and neither does re-rejecting.
    */
    if (input.decision === 'approve') await this.assertDocumentsOnFile(partner.id);

    const policy = await this.sanctionsPolicy();

    if (
      input.decision === 'approve' &&
      policy === 'required' &&
      partner.sanctionsScreenedAt === null
    ) {
      throw badRequest(ERROR.PARTNER_SANCTIONS_SCREENING_REQUIRED);
    }

    const nextStatus = input.decision === 'approve' ? 'approved' : 'rejected';

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.partners)
        .set({
          verification: nextStatus,
          /*
            The policy in force AT THIS APPROVAL, stamped once and never recomputed.

            Recomputing it later would answer a different question — what the policy is now, not
            what it was when somebody decided. Only stamped on an approval: a rejection lets
            nobody near any money, so there is nothing about it for this column to explain.
          */
          ...(input.decision === 'approve' ? { sanctionsPolicyAtApproval: policy } : {}),
          ...(input.decision === 'approve'
            ? { verifiedAt: new Date(), verifiedByUserId: claims?.sub ?? null }
            : {}),
        })
        .where(eq(schema.partners.id, partner.id));

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: `partner.${nextStatus}`,
          subjectType: 'partner',
          subjectId: partner.id,
          before: { verification: partner.verification },
          after: { verification: nextStatus },
          reason: input.notes ?? null,
        },
        tx as unknown as Database,
      );

      await tx.insert(schema.timelineEvents).values({
        subjectType: 'partner',
        subjectId: partner.id,
        eventType: `partner.${nextStatus}`,
        actorType: 'staff',
        actorUserId: claims?.sub ?? null,
        payload: { notes: input.notes ?? null },
      });

      /**
       * Rejecting or suspending a partner must take their live listings down with
       * them — otherwise an unverified operator keeps selling. Suspension, never
       * deletion (P-003).
       */
      if (input.decision === 'reject') {
        await tx
          .update(schema.properties)
          .set({ status: 'suspended' })
          .where(
            and(
              eq(schema.properties.partnerId, partner.id),
              eq(schema.properties.status, 'published'),
            ),
          );
      }
    });

    /*
      Tell the partner, AFTER the commit and never blocking it (Bashar, 2026-08-21).

      Approval is the moment the portal opens, and until now nothing said so: a partner learned
      they were approved by signing in and noticing the sidebar had grown. The mail names what is
      newly possible rather than only that a status changed.

      Approval only. A rejection has its own conversation — a partner told "the outcome is
      recorded" by an automated message would be worse than being telephoned, which is what the
      journey actually calls for.

      A failure here cannot undo a verification that has already committed, so it is logged and
      swallowed. The partner is approved either way, and the portal shows it.
    */
    if (input.decision === 'approve') {
      await this.notifyPartnerApproved(partner.id, reference).catch((error: unknown) => {
        this.logger.error(
          `Could not tell ${reference} they were approved: ` + `${describeError(error)}`,
        );
      });
    }

    return { reference, verification: nextStatus };
  }

  /**
   * "Your account is approved and the portal is open."
   *
   * `users.email` rather than `partners.email`: the account is what receives platform mail, and
   * the two can differ. The partner's own locale, for the same reason every other outbound message
   * uses it.
   */
  private async notifyPartnerApproved(
    partnerId: string,
    reference: string,
  ): Promise<void> {
    const rows = await this.db.execute<{ email: string; locale: string }>(sql`
      SELECT u.email, u.preferred_locale AS locale
      FROM partners p JOIN users u ON u.id = p.user_id
      WHERE p.id = ${partnerId}::uuid AND p.deleted_at IS NULL
      LIMIT 1
    `);

    const partner = rows.rows[0];

    if (!partner) return;

    await this.mail.send(
      partnerApprovedMail({
        to: partner.email,
        reference,
        url: new URL('/', this.env.PARTNER_URL).toString(),
        locale: partner.locale,
      }),
    );

    this.logger.log(`Told ${reference} that their account is approved.`);
  }

  /** Records that screening was performed, with the provider's raw result. */
  /**
   * RUNS a screening against the imported list and records the result (ADR 0002).
   *
   * This used to accept whatever result the caller supplied, which meant the legal
   * obligation was satisfied by a staff member asserting they had checked. Now the
   * platform performs the search itself against the newest EU consolidated-list
   * snapshot, and the recorded result is what the search actually returned.
   *
   * A reviewer can still override the outcome — `matched` is theirs to set, because
   * only a human can judge whether a fuzzy hit is the same person — but they are
   * overriding evidence rather than producing it from nothing.
   */
  async recordSanctionsScreening(
    claims: AccessTokenClaims | undefined,
    reference: string,
    input: { matched?: boolean | undefined; notes?: string | undefined },
  ) {
    /*
      Scoped by the partner's city (`O-sec-13`, 2026-08-27).

      Recording a screening writes `sanctions_screened_at` and a reviewer's judgement onto a
      partner's compliance record, and it was reachable for any partner in the country by
      reference. `scopeCondition` rather than `scopeFilter` because this is the relational builder,
      and it returns `undefined` for an unrestricted scope so an unscoped member's query is
      unchanged.

      `city_id` comes back so `assertCanWrite` can refuse the `read_only` member the predicate
      deliberately lets through.
    */
    const partner = await this.db.query.partners.findFirst({
      where: and(
        eq(schema.partners.reference, reference),
        isNull(schema.partners.deletedAt),
        scopeCondition(claims, schema.partners.cityId),
      ),
      columns: { id: true, legalName: true, displayName: true, cityId: true },
    });

    if (!partner) throw notFound(ERROR.PARTNER_NOT_FOUND);

    assertCanWrite(claims, partner.cityId);

    /**
     * Both names are searched. A designation may name the company or the person
     * signing for it, and a partner registers with both.
     */
    const outcome = await this.sanctions.screen([partner.legalName, partner.displayName]);

    /**
     * The reviewer's judgement wins over the machine's, in EITHER direction.
     *
     * Up, because a reviewer who recognises a name the matcher scored as weak must
     * be able to flag it. Down, because the matcher deliberately over-flags and a
     * human confirming "different person, different country, different birth year"
     * is exactly the decision this design reserves for people.
     */
    const matched = input.matched ?? outcome.matched;

    const result = {
      ...outcome,
      matched,
      /** Recorded when the reviewer disagreed with the automated reading. */
      ...(input.matched !== undefined && input.matched !== outcome.matched
        ? { overriddenBy: claims?.sub ?? null, automatedMatch: outcome.matched }
        : {}),
      ...(input.notes ? { reviewerNotes: input.notes } : {}),
    };

    await this.db
      .update(schema.partners)
      .set({ sanctionsScreenedAt: new Date(), sanctionsScreeningResult: result })
      .where(eq(schema.partners.id, partner.id));

    await this.audit.record({
      actorUserId: claims?.sub,
      actorRole: claims?.role,
      action: 'partner.sanctions_screened',
      subjectType: 'partner',
      subjectId: partner.id,
      after: {
        screenedAt: new Date().toISOString(),
        source: outcome.source,
        snapshotId: outcome.snapshotId,
        candidateCount: outcome.candidates.length,
        matched,
        automatedMatch: outcome.matched,
      },
    });

    return { reference, screened: true, matched, candidates: outcome.candidates };
  }

  /** Counts for the §9.2 "needs your attention now" panel. */
  /**
   * The badges beside the queues — counted within the reader's own cities (`O-sec-13`, 2026-08-27).
   *
   * This took no actor. Every queue it counts is scoped where it is LISTED, so a city-scoped
   * operator read «١٢ عقاراً بانتظار المراجعة» over a list that showed three — the badge and the
   * screen contradicting each other, and the difference being a count of another city's work.
   *
   * A count is not a row, so this is the smallest of the gaps found in this pass. It is still
   * cross-city information the member is not scoped to have, and «the numbers do not match the
   * list» is how somebody discovers that the two are answering different questions.
   *
   * Every counter narrows by the city its own subject carries; `partner_documents` and the two
   * booking counters reach one through a join, which is the shape that hid the others.
   */
  async attentionCounts(actor?: AccessTokenClaims) {
    const rows = await this.db.execute<{ metric: string; count: string }>(sql`
      SELECT 'properties_pending_review' AS metric, COUNT(*)::text AS count
        FROM properties WHERE status = 'pending_review' AND deleted_at IS NULL
          AND ${scopeFilter(actor, 'city_id')}
      UNION ALL
      SELECT 'partners_pending_verification', COUNT(*)::text
        FROM partners WHERE verification = 'pending' AND deleted_at IS NULL
          AND ${scopeFilter(actor, 'city_id')}
      UNION ALL
      -- Requests to JOIN, which nobody has decided yet (Bashar, 2026-08-19).
      SELECT 'partner_applications_open', COUNT(*)::text
        FROM partner_applications
        WHERE status IN ('submitted', 'contacted') AND deleted_at IS NULL
          AND ${scopeFilter(actor, 'city_id')}
      UNION ALL
      SELECT 'partners_unscreened', COUNT(*)::text
        FROM partners WHERE sanctions_screened_at IS NULL AND deleted_at IS NULL
          AND ${scopeFilter(actor, 'city_id')}
      UNION ALL
      -- Documents sent and not yet looked at. See the note on the same counter in
      -- DashboardService: the upload itself moved no number that staff could see.
      SELECT 'partner_documents_pending_review', COUNT(*)::text
        FROM partner_documents pd
        JOIN partners pdp ON pdp.id = pd.partner_id AND pdp.deleted_at IS NULL
        WHERE pd.status = 'pending' AND pd.deleted_at IS NULL
          AND ${scopeFilter(actor, 'pdp.city_id')}
      UNION ALL
      SELECT 'bookings_awaiting_confirmation', COUNT(*)::text
        FROM bookings WHERE status = 'pending_confirmation' AND deleted_at IS NULL
          AND ${scopeFilter(actor, 'city_id')}
      UNION ALL
      -- SLA about to lapse: the single most time-critical queue (§6.4).
      SELECT 'bookings_sla_expiring_within_30m', COUNT(*)::text
        FROM bookings
        WHERE status = 'pending_confirmation'
          AND confirmation_deadline_at IS NOT NULL
          AND confirmation_deadline_at <= now() + (${SLA_EXPIRY_WARNING_MINUTES}::int * INTERVAL '1 minute')
          AND deleted_at IS NULL
          AND ${scopeFilter(actor, 'city_id')}
    `);

    return Object.fromEntries(rows.rows.map((r) => [r.metric, Number(r.count)]));
  }
}
