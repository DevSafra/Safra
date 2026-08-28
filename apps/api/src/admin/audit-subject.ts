import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { actorName, actorRealName } from '../common/actor-name.sql.js';

/**
 * What an audit entry HAPPENED TO, named rather than identified.
 *
 * ## The rule this exists for
 *
 * Bashar, 2026-08-24, as a standing instruction: *"When an activity says الموافقة على الشريك…
 * write the partner name (details) so me as a super admin can really know everything in details.
 * Set that as a rule for the future also."*
 *
 * So: **an audit entry names the thing it happened to.** «الموافقة على الشريك» followed by a uuid
 * is not an answer to "what happened" — it is the question restated. It has to read «الموافقة على
 * الشريك — فندق الشام (PAR-000123)», and the reference has to be clickable, because the next thing
 * a super admin wants is that record.
 *
 * ## Why here and not on the screen
 *
 * The console would need a fetch per row to turn twenty-five uuids into twenty-five names, and it
 * would be a SECOND answer to "what is this thing called" — the first being whatever the registry
 * that owns it prints. One join, server-side, from the table that owns the name.
 *
 * ## Batched, not per row
 *
 * One query per subject TYPE present in the page, never one per row. A page of twenty-five entries
 * touching four kinds of thing costs four queries, and every one of them is a primary-key lookup
 * over an `IN` list. The N+1 shape this avoids is the one rule 2 forbids by name.
 *
 * ## A resolved name is shown to readers whose role does not open that registry — deliberately
 *
 * Raised by project-cc, 2026-08-24, and it is the right question: this joins to `partners`, so a
 * reader holding `audit_log.read` or `staff.manage` and NOT `partner.read` learns a partner's name
 * from the trail. Same shape as the dashboard's payout line — the section is legitimately theirs
 * and a value rides along that is not.
 *
 * It is correct here, for two reasons that have to both hold:
 *
 * 1. **A trail that cannot say what happened is not a trail.** The audit log is deliberately
 *    unscoped — it is the record consulted when the question is "who did this", and an answer of
 *    «الموافقة على الشريك» plus a uuid cannot be acted on by anybody.
 * 2. **Both capabilities that reach it are already higher than what they would be protecting.**
 *    `staff.manage` is how every other permission is handed out: a holder can define a role
 *    carrying `partner.read` and assign it to themselves. Withholding the name from them is
 *    theatre, and theatre in a security boundary is worse than an honest opening because it makes
 *    the next reader think something is enforced.
 *
 * What is NOT shown is anything the registry itself withholds: no addresses, no contact details,
 * and never a gift card's code — see the `gift_card` entry, which names the recipient and not the
 * bearer credential. The rule is "name the thing", not "show everything about it".
 *
 * ## An unresolvable subject answers NULL, and the screen says so
 *
 * A settings key with no row, a record deleted since, a type nobody has mapped: all null. The
 * screen prints the raw type and id rather than hiding the entry, because an audit trail that
 * quietly omits what it cannot explain is worse than one that admits it. `audit-subject.integration
 * .test.ts` fails when a subject type PRESENT IN THE DATABASE has no entry here, so the gap is
 * visible rather than silent.
 */
export type AuditSubject = {
  readonly type: string;
  /** `PAR-000123` — what a person quotes. Null for records that carry no reference. */
  readonly reference: string | null;
  /** «فندق الشام» — what a person recognises. */
  readonly label: string | null;
  /** Where the record lives in the console, or null when it has no screen. */
  readonly href: string | null;
};

/**
 * Subject type → where its name lives.
 *
 * `label` and `reference` are SQL expressions rather than column names so a table whose name is
 * assembled from two columns — a person's name and their address, a unit and its property — can
 * say so here instead of forcing the caller to know.
 *
 * `href` takes the reference where the console addresses records by reference and the id where it
 * does not. Getting that backwards produces a link that 404s, so each one is written against the
 * route that actually exists rather than assumed from the pattern.
 */
type Source = {
  readonly table: string;
  readonly reference: SQL;
  readonly label: SQL;
  readonly href: ((row: { reference: string | null; id: string }) => string) | null;
};

const SOURCES: Record<string, Source> = {
  partner: {
    table: 'partners',
    reference: sql`reference`,
    label: sql`display_name`,
    href: (row) => `/partners/${row.reference}`,
  },
  partner_application: {
    table: 'partner_applications',
    reference: sql`reference`,
    label: sql`legal_name`,
    href: (row) => `/applications/${row.reference}`,
  },
  property: {
    table: 'properties',
    reference: sql`reference`,
    label: sql`name_ar`,
    href: (row) => `/properties/${row.reference}`,
  },
  booking: {
    table: 'bookings',
    reference: sql`reference`,
    label: sql`reference`,
    href: (row) => `/bookings/${row.reference}`,
  },
  customer_profile: {
    table: 'customer_profiles',
    reference: sql`reference`,
    label: sql`full_name`,
    href: (row) => `/customers/${row.reference}`,
  },
  /*
    A staff account is named by `full_name` and falls back to the address — 165 accounts predate
    the column and `coalesce` is honest about that, where a null label would make the entry read as
    unresolvable when the record is right there.
  */
  user: {
    table: 'users',
    /*
      The address rides beside the NAME, and only when there is a name to ride beside.

      `label` has always preferred `full_name`; project-e9 saw «doc-reviewer@safra.test» on the
      screen and read it as the name being ignored. It was the fallback working — that account has
      no name, like the 165 others predating the column. But an entry about a PERSON should say who
      and also which account, the way `actorName` and `actorEmail` already sit together.

      `CASE WHEN full_name IS NOT NULL` rather than always: with no name the label is already the
      address, and «doc-reviewer@safra.test (doc-reviewer@safra.test)» is worse than either half.
    */
    /*
      A super admin named as the SUBJECT is pseudonymised too (Bashar's rule, 2026-08-23).

      ## The row that made this obvious

      A sign-in is a self-action: subject IS actor. So سجل التدقيق pseudonymised the actor column
      and re-identified the same person one column across — «Admin · تسجيل دخول ناجح · مستخدم /
      موظف الاختبار / ops@safra.test». Found by project-e9 on a screenshot, two hours after the
      first leak of the same kind, with the suite green both times.

      ## Why the whole `user` subject and not only the self-action case

      Narrowing it to subject-equals-actor was the tempting fix and it protects the wrong thing.
      What the pseudonym defends is not just attribution — it is the MEMBERSHIP of the anonymous
      set. A row reading «Admin changed the role of موظف الاختبار» tells any reader that موظف
      الاختبار is a super admin, and on a platform with two or three of them that is most of the
      way to knowing who «Admin» is. Reversing a pseudonym by enumerating its set is the ordinary
      way pseudonyms fail, and it does not require the actor and the subject to be the same row.

      ## What is NOT lost

      Bashar's other rule — *"write the partner name so me as a super admin can really know
      everything in details"* — still holds for every other subject: partners, properties,
      bookings, customers, ordinary staff. This is one role, and the trail still names the action,
      the time, and `subject_id`, which is the record itself. `href` is unchanged for the same
      reason: an id is not an identity, and the screen it opens needs `staff.manage`.

      Same predicate as the actor columns, from `ANONYMOUS_STAFF_ROLES`, so there is one answer to
      "who acts under a pseudonym" and not a third copy of it.
    */
    reference: actorRealName(
      sql`CASE WHEN full_name IS NOT NULL THEN email END`,
      sql`role`,
    ),
    label: actorName(sql`coalesce(full_name, email)`, sql`role`),
    href: (row) => `/staff/${row.id}`,
  },
  dispute: {
    table: 'disputes',
    reference: sql`reference`,
    label: sql`reference`,
    href: (row) => `/disputes/${row.reference}`,
  },
  /*
    A thread is named by its own reference and nothing else.

    Not by the customer or the partner in it: this screen is read by more people than the record is,
    and `audit-anonymity` holds that line for every other subject here. `CNV-000042` is what the
    inbox shows and what the console route takes, so the entry names the thing a reader can open.
  */
  conversation: {
    table: 'conversations',
    reference: sql`reference`,
    label: sql`reference`,
    href: (row) => `/messages/${row.reference}`,
  },
  review: {
    table: 'reviews',
    reference: sql`reference`,
    label: sql`reference`,
    href: null,
  },
  gift_card: {
    table: 'gift_cards',
    reference: sql`reference`,
    /* NEVER the code, and not even the hash — a gift card's code is a bearer credential. */
    label: sql`coalesce(recipient_name, recipient_email)`,
    href: null,
  },
  coupon: {
    table: 'coupons',
    /*
      A coupon's CODE is its reference — it is what an operator searches for and what a customer was
      told, and unlike a gift card code it is meant to be shared. There is no separate reference
      column, so the code serves as both.
    */
    reference: sql`code`,
    label: sql`code`,
    /* الكوبونات is one registry with no detail screen; the code identifies the row on it. */
    href: null,
  },
  ad_campaign: {
    table: 'ad_campaigns',
    reference: sql`reference`,
    label: sql`reference`,
    href: null,
  },
  /*
    The business that pays, distinct from a partner who sells.

    `href: null` for the same reason as `ad_campaign`: الإعلانات is a registry with no per-record
    screen, so a link would be to a page that does not exist. A reader gets the NAME rather than a
    uuid, which is what this map is for.
  */
  advertiser: {
    table: 'advertisers',
    reference: sql`reference`,
    label: sql`name`,
    href: null,
  },
  ad_invoice: {
    table: 'ad_invoices',
    reference: sql`reference`,
    label: sql`reference`,
    href: null,
  },
  unit: {
    table: 'units',
    reference: sql`NULL`,
    label: sql`name_ar`,
    href: null,
  },
  city: {
    table: 'cities',
    reference: sql`slug`,
    label: sql`name_ar`,
    href: null,
  },
  staff_role: {
    table: 'staff_roles',
    reference: sql`NULL`,
    label: sql`name`,
    href: null,
  },
  partner_employee_role: {
    table: 'partner_employee_roles',
    reference: sql`NULL`,
    label: sql`name`,
    href: null,
  },
  setting: {
    table: 'settings',
    reference: sql`key`,
    label: sql`key`,
    href: null,
  },
  partner_payout: {
    table: 'partner_payouts',
    reference: sql`reference`,
    label: sql`reference`,
    href: null,
  },
  partner_contract: {
    table: 'partner_contracts',
    reference: sql`NULL`,
    label: sql`kind::text`,
    href: null,
  },
  /*
    These five were MISSING and the database said so — `audit-subject.integration.test.ts` named
    them against 42,767 real rows. Reading the source for `subjectType: '…'` had found the first
    seventeen and missed these, which is the same blind spot that hid two audit ACTIONS behind
    template literals in August.

    Each names the thing a reader would recognise, not the row's own identity: an export by its
    reference, a rate by the pair it prices, an employee by their name, an image by the listing it
    belongs to, a wallet by whose it is.
  */
  booking_export: {
    table: 'export_jobs',
    reference: sql`reference`,
    label: sql`kind`,
    href: null,
  },
  fx_rate: {
    table: 'fx_rates',
    reference: sql`NULL`,
    /* «USD → SYP» — the pair, because a rate's id tells a reader nothing at all. */
    label: sql`(
      SELECT b.code || ' → ' || q.code
      FROM currencies b, currencies q
      WHERE b.id = fx_rates.base_currency_id AND q.id = fx_rates.quote_currency_id
    )`,
    href: null,
  },
  partner_employee: {
    table: 'partner_employees',
    reference: sql`NULL`,
    label: sql`full_name`,
    href: null,
  },
  property_image: {
    table: 'property_images',
    reference: sql`NULL`,
    /* The LISTING it belongs to. An image's own id is not something anybody recognises. */
    label: sql`(
      SELECT p.name_ar FROM properties p WHERE p.id = property_images.property_id
    )`,
    href: null,
  },
  wallet: {
    table: 'wallets',
    reference: sql`NULL`,
    label: sql`(
      SELECT c.full_name FROM customer_profiles c
      WHERE c.id = wallets.customer_profile_id
    )`,
    href: null,
  },
};

/** Which subject types this module can name — for the test that holds it to the database. */
export const RESOLVABLE_SUBJECT_TYPES = Object.keys(SOURCES);

/**
 * Names the subjects of a page of entries, in one query per type.
 *
 * The map is keyed by `${type}:${id}` because two tables can hold the same uuid — vanishingly
 * unlikely with uuidv7 and not something to leave to chance in a record people rely on.
 */
export async function resolveSubjects(
  db: Database,
  entries: readonly { subjectType: string; subjectId: string | null }[],
): Promise<Map<string, AuditSubject>> {
  const wanted = new Map<string, Set<string>>();

  for (const entry of entries) {
    if (!entry.subjectId || !SOURCES[entry.subjectType]) continue;

    const ids = wanted.get(entry.subjectType) ?? new Set<string>();

    ids.add(entry.subjectId);
    wanted.set(entry.subjectType, ids);
  }

  const resolved = new Map<string, AuditSubject>();

  for (const [type, ids] of wanted) {
    const source = SOURCES[type];

    if (!source) continue;

    /*
      `IN (…)` over joined parameters. A JS array interpolated into a drizzle template becomes a
      TUPLE, not an array — the trap that broke three live endpoints on 2026-08-23 and 24.
    */
    const rows = await db.execute<{
      id: string;
      reference: string | null;
      label: string | null;
    }>(sql`
      SELECT id::text AS id,
             ${source.reference}::text AS reference,
             ${source.label}::text AS label
      FROM ${sql.raw(source.table)}
      WHERE id IN (${sql.join(
        [...ids].map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
    `);

    for (const row of rows.rows) {
      resolved.set(`${type}:${row.id}`, {
        type,
        reference: row.reference,
        label: row.label,
        href: source.href ? source.href({ reference: row.reference, id: row.id }) : null,
      });
    }
  }

  return resolved;
}
