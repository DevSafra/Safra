import { eq, sql } from 'drizzle-orm';

import { createDatabase, schema, type Database, type Transaction } from '@safra/db';

import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import type { Env } from '../config/env.js';
import { describeError } from '../common/errors/safe-error.js';

/**
 * A small, hand-built dataset you can actually test against — three شركاء, one customer, and
 * bookings that put every screen into a state worth looking at.
 *
 * ## Why this is a script and not part of the seed
 *
 * `src/seed/index.ts` seeds REFERENCE data — cities, currencies, property types — and is safe to
 * run on every deploy. This creates people and bookings, which is only ever wanted on a developer's
 * machine. Same reasoning as `reset-dev.ts`: the distinction is which directory it lives in, not a
 * flag somebody has to remember.
 *
 * ## What it makes
 *
 * Three partners, all approved and published, because the point is to have a partner dashboard that
 * is full the moment you sign in (Bashar, 2026-08-06):
 *
 * | partner              | city      | properties |
 * | -------------------- | --------- | ---------- |
 * | فندق قصر الشرق       | دمشق      | 3          |
 * | شاليهات الساحل       | اللاذقية  | 2          |
 * | بيت دمشقي تراثي      | دمشق      | 1          |
 *
 * One customer with four bookings spread across them, chosen so that each is a different state:
 * confirmed, completed, cancelled with a refund, and one still waiting on a partner decision — the
 * last so there is something to DO in the partner dashboard rather than only something to read.
 *
 * ## Money is computed, not typed
 *
 * Every amount is derived here the way `PricingService` derives it — nightly rate × nights, a flat
 * $1.99 customer fee, 7% partner commission — because a fixture with amounts that do not add up
 * makes the console's own figures impossible to check. If the platform's rates change, this drifts
 * and the totals stop reconciling; that is a deliberate trade for a script nobody deploys.
 *
 * ## Idempotent
 *
 * Re-running replaces what it made, keyed on the fixture emails, and touches nothing else. So it is
 * safe after `db:reset-dev` and safe on a database that already has it.
 */

/** The flat service fee (§1.4) and the partner commission, from the handoff. */
const CUSTOMER_FEE = 1.99;
const COMMISSION_RATE = 0.07;
/**
 * The customer fixture's opening wallet balance — ONE constant, used three times.
 *
 * The balance, the credit amount and its `balance_after` all have to say the same thing, because محفظتي
 * derives how much of a balance came from a gift card by reading the statement: a balance with a smaller
 * history behind it reports the difference as gift money on a wallet that has never seen a gift card.
 *
 * They were three literals until 2026-08-11, and editing the balance from 25 to 35 left the transaction
 * at 25 — the drift this constant exists to make impossible.
 */
const WALLET_OPENING_BALANCE = '35.00';

/** The default SYP rate the handoff names. Snapshotted onto every booking, as production does. */
const FX_RATE_TO_SYP = 12500;

/**
 * The §7.1 two-hour window a partner has to answer a request.
 *
 * A constant here rather than a settings read, because this script writes fixtures rather than
 * pricing anything — but the VALUE has to match `settings`, or the dashboard's countdown and the
 * sweep that levies the fine would disagree about when the clock runs out.
 */
const CONFIRMATION_WINDOW_MINUTES = 120;

const PASSWORD = process.env['TESTBED_PASSWORD'] ?? 'a-testbed-password-1';

/**
 * The TOTP secret the enrolled fixture partners share.
 *
 * Partner 2FA is mandatory (Bashar, 2026-08-07), so a testbed whose partners were all unenrolled
 * would leave every screen behind the enrolment gate untestable — and a suite that enrolled them
 * itself would need somewhere to keep the secret anyway.
 *
 * A fixed dev constant, overridable, exactly like `TESTBED_PASSWORD` above. It authenticates
 * nothing outside a local `safra` database: `db:reset-dev` refuses a non-local connection string,
 * and this script only ever runs beside it.
 */
const PARTNER_TOTP_SECRET =
  process.env['TESTBED_PARTNER_TOTP_SECRET'] ?? 'KRSXG5CTMVRXEZLUMU2TAMBQGAYA';

interface UnitSpec {
  readonly nameAr: string;
  readonly nameEn: string;
  readonly price: number;
  readonly maxGuests: number;
}

interface PropertySpec {
  readonly nameAr: string;
  readonly nameEn: string;
  readonly slug: string;
  readonly citySlug: string;
  readonly type: string;
  readonly address: string;
  readonly descriptionAr: string;
  /** From `TRIP_ATTRIBUTES` — the ONE shared vocabulary (§5.6). Never a list forked here. */
  readonly attributes: readonly string[];
  readonly units: readonly UnitSpec[];
  /**
   * Where this listing sits in the §8.1 lifecycle. Defaults to published.
   *
   * Present because `STRUCTURALLY_EDITABLE` makes the EDIT form reachable only for a draft,
   * pending_review or rejected listing — so a testbed of nothing but published ones can exercise
   * the refusal and never the form. Both halves of that rule need a fixture or only one of them
   * is ever tested.
   */
  readonly status?: 'draft' | 'pending_review' | 'rejected' | 'published';
  /** Why staff rejected it. Only meaningful with `status: 'rejected'`, and shown on the form. */
  readonly reviewNotes?: string;
}

/**
 * Fixed ids for the two fixtures a SESSION can point at.
 *
 * An access token embeds `customerProfileId` for a customer and `partnerId` for a partner, so ownership
 * filtering costs no query on the hot path. This script DELETES and recreates both rows on every run —
 * it has to, because the cleanup walks foreign keys — and with generated ids that handed every recreated
 * fixture a new identity.
 *
 * The consequence bit Bashar (2026-08-11): reseeding while signed in left his token pointing at a
 * customer profile that no longer existed. Nothing errored. The greeting lost its name, the badges
 * vanished, and حجوزاتي, الفواتير, المفضلة and محفظتي all came back empty — which reads as "my data is
 * gone" rather than as "sign in again".
 *
 * Pinning the ids makes a reseed survivable: the rows are rebuilt with the same identity, so a token
 * minted before it still resolves. Guest profiles are left generated — nobody signs in as one.
 *
 * Version nibble 4, so these cannot collide with the `uuidv7()` the columns default to, and a
 * recognisable prefix so one of them in a log or a query is obviously a fixture rather than real data.
 */
const FIXTURE_CUSTOMER_PROFILE_ID = '5afe0000-0000-4000-8000-000000000001';

interface PartnerSpec {
  /** Fixed, so a partner session survives a reseed — see `FIXTURE_CUSTOMER_PROFILE_ID`. */
  readonly id: string;
  readonly email: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly citySlug: string;
  readonly type: string;
  readonly phone: string;
  readonly address: string;
  readonly score: number;
  readonly tier: 'new' | 'needs_improvement' | 'silver' | 'gold';
  /**
   * Whether this fixture partner arrives with a second factor already enrolled.
   *
   * Both states are needed and neither is incidental. The enrolled ones let the suite reach every
   * screen behind the gate; the unenrolled one is the FORCED-ENROLMENT fixture — the existing
   * partner meeting a requirement that did not exist when their account was made, which is the
   * migration behaviour the 2FA work has to keep proving.
   */
  readonly twoFactorEnrolled: boolean;
  readonly properties: readonly PropertySpec[];
}

const PARTNERS: readonly PartnerSpec[] = [
  {
    id: '5afe0000-0000-4000-8000-000000000011',
    /*
      NOT `partner1@safra.test`, since 2026-08-21 (Bashar).

      That address is now the applicant fixture — a CUSTOMER who has never been a partner, kept
      free so the partner-joining journey can be walked by hand from its first screen. See
      `APPLICANT` below.

      This partner owns five listings and forty-four bookings and is what most of the partner
      browser suite signs in as, so it could not simply be deleted to free the address. It was
      handed to its own account instead: same password, same everything, different email.
    */
    email: 'partner1-legacy@safra.test',
    legalName: 'شركة قصر الشرق للفنادق',
    displayName: 'فندق قصر الشرق',
    citySlug: 'damascus',
    type: 'accommodation',
    phone: '+963933000001',
    address: 'شارع بغداد، دمشق',
    score: 92,
    tier: 'gold',
    twoFactorEnrolled: false,
    properties: [
      {
        nameAr: 'فندق قصر الشرق — المالكي',
        nameEn: 'Qasr Al-Sharq Hotel — Malki',
        slug: 'qasr-al-sharq-malki',
        attributes: ['history', 'business', 'internet', 'parking'],
        citySlug: 'damascus',
        type: 'hotel',
        address: 'المالكي، دمشق',
        descriptionAr: 'فندق أربع نجوم في قلب المالكي، على بعد دقائق من وسط المدينة.',
        units: [
          { nameAr: 'غرفة مزدوجة', nameEn: 'Double Room', price: 65, maxGuests: 2 },
          { nameAr: 'جناح تنفيذي', nameEn: 'Executive Suite', price: 140, maxGuests: 4 },
        ],
      },
      {
        nameAr: 'فندق قصر الشرق — أبو رمانة',
        nameEn: 'Qasr Al-Sharq Hotel — Abu Rummaneh',
        slug: 'qasr-al-sharq-abu-rummaneh',
        attributes: ['history', 'business', 'internet'],
        citySlug: 'damascus',
        type: 'hotel',
        address: 'أبو رمانة، دمشق',
        descriptionAr: 'فرعنا الثاني، بإطلالة على جبل قاسيون.',
        units: [{ nameAr: 'غرفة مفردة', nameEn: 'Single Room', price: 45, maxGuests: 1 }],
      },
      {
        /* The draft: what the تعديل form is actually tested against. */
        nameAr: 'نزل قصر الشرق — قيد الإعداد',
        nameEn: 'Qasr Al-Sharq Lodge — In Preparation',
        slug: 'qasr-al-sharq-lodge',
        attributes: ['history', 'internet'],
        citySlug: 'damascus',
        type: 'apartment',
        address: 'باب توما، دمشق',
        descriptionAr: 'نزل صغير في المدينة القديمة، لم يُرسَل للمراجعة بعد.',
        status: 'draft',
        units: [
          { nameAr: 'غرفة بإطلالة', nameEn: 'Room with a View', price: 60, maxGuests: 2 },
        ],
      },
      {
        /* The rejected one, with the reason a partner reopens the form to fix. */
        nameAr: 'استراحة قصر الشرق — مرفوضة',
        nameEn: 'Qasr Al-Sharq Rest House — Rejected',
        slug: 'qasr-al-sharq-rest-house',
        attributes: ['families'],
        citySlug: 'damascus',
        type: 'apartment',
        address: 'دمر، دمشق',
        descriptionAr: 'استراحة عائلية.',
        status: 'rejected',
        reviewNotes: 'العنوان في الوثائق لا يطابق العنوان المُدخل. صحّحه وأعد الإرسال.',
        units: [
          { nameAr: 'جناح عائلي', nameEn: 'Family Suite', price: 80, maxGuests: 6 },
        ],
      },
      {
        nameAr: 'شقق قصر الشرق المخدومة',
        nameEn: 'Qasr Al-Sharq Serviced Apartments',
        slug: 'qasr-al-sharq-apartments',
        attributes: ['families', 'internet', 'parking'],
        citySlug: 'damascus',
        type: 'apartment',
        address: 'المزة، دمشق',
        descriptionAr: 'شقق مفروشة للإقامات الطويلة، بمطبخ كامل.',
        units: [
          {
            nameAr: 'شقة بغرفتين',
            nameEn: 'Two-Bedroom Apartment',
            price: 95,
            maxGuests: 5,
          },
        ],
      },
    ],
  },
  {
    id: '5afe0000-0000-4000-8000-000000000012',
    email: 'partner2@safra.test',
    legalName: 'مؤسسة الساحل للسياحة',
    displayName: 'شاليهات الساحل',
    citySlug: 'latakia',
    type: 'accommodation',
    phone: '+963933000002',
    address: 'الكورنيش الجنوبي، اللاذقية',
    score: 78,
    tier: 'silver',
    twoFactorEnrolled: false,
    properties: [
      {
        nameAr: 'شاليهات الساحل — بلوران',
        nameEn: 'Coastal Chalets — Blouran',
        slug: 'coastal-chalets-blouran',
        attributes: ['sea', 'pool', 'families'],
        citySlug: 'latakia',
        type: 'chalet',
        address: 'بلوران، اللاذقية',
        descriptionAr: 'شاليهات على البحر مباشرة، مع مسبح مشترك.',
        units: [
          { nameAr: 'شاليه عائلي', nameEn: 'Family Chalet', price: 110, maxGuests: 6 },
          { nameAr: 'شاليه صغير', nameEn: 'Studio Chalet', price: 70, maxGuests: 2 },
        ],
      },
      {
        nameAr: 'منتجع الساحل',
        nameEn: 'Coastal Resort',
        slug: 'coastal-resort',
        attributes: ['sea', 'pool', 'honeymoon'],
        citySlug: 'latakia',
        type: 'hotel',
        address: 'الشاطئ الأزرق، اللاذقية',
        descriptionAr: 'منتجع متكامل مع مطعم ونادٍ رياضي.',
        units: [
          { nameAr: 'جناح بحري', nameEn: 'Sea-View Suite', price: 165, maxGuests: 4 },
        ],
      },
    ],
  },
  {
    id: '5afe0000-0000-4000-8000-000000000013',
    email: 'partner3@safra.test',
    legalName: 'بيت الياسمين للضيافة التراثية',
    displayName: 'بيت دمشقي تراثي',
    citySlug: 'damascus',
    type: 'accommodation',
    phone: '+963933000003',
    address: 'باب توما، دمشق القديمة',
    score: 85,
    tier: 'gold',
    twoFactorEnrolled: false,
    properties: [
      {
        nameAr: 'بيت الياسمين الدمشقي',
        nameEn: 'Beit Al-Yasmine Damascene House',
        slug: 'beit-al-yasmine',
        attributes: ['history', 'honeymoon', 'nature'],
        citySlug: 'damascus',
        type: 'rural_house',
        address: 'باب توما، دمشق القديمة',
        descriptionAr: 'بيت دمشقي من القرن التاسع عشر، بفناء وبحرة ونافورة.',
        units: [
          { nameAr: 'غرفة القبو', nameEn: 'Vaulted Room', price: 85, maxGuests: 2 },
          { nameAr: 'الليوان', nameEn: 'The Liwan', price: 120, maxGuests: 4 },
        ],
      },
    ],
  },
];

const CUSTOMER = {
  email: 'customer@safra.test',
  fullName: 'ليلى الحمصي',
  phone: '+963955000001',
} as const;

/**
 * An account that is a CUSTOMER and has never been a partner (Bashar, 2026-08-21).
 *
 * Every other fixture arrives already approved, which is the state the console screens need — and
 * it means the one journey nobody could rehearse was the one a real partner actually takes: apply,
 * be contacted, be invited, set a password, upload documents, be verified. Walking it needed an
 * address that is not already on the far side of it, and creating one by hand each time is how a
 * test ends up depending on whatever happened to be in the database.
 *
 * ## It gets a PROFILE and a WALLET, like any registration
 *
 * The first version of this fixture deliberately had neither, reasoning that applying does not
 * require them — `partner_applications.submitted_by_user_id` is nullable and the form collects its
 * own contact details. That reasoning was too narrow and it was wrong: the account is a CUSTOMER
 * account, so the reader signs in on the customer site, and حسابي and محفظتي both refuse an
 * account with no profile. Bashar hit it within minutes (2026-08-21).
 *
 * A fixture has to be the state it claims to be. `AuthService.register` writes a user, a profile
 * and a zero wallet in one transaction, so a "customer" made of only the first of those three is
 * a shape no registration can produce — the fixture was modelling something that cannot exist.
 */
const APPLICANT = {
  email: 'partner1@safra.test',
  phone: '+963933000001',
  fullName: 'مالك إقامة',
} as const;

/** Which unit each booking lands on, and what state it ends in. */
const BOOKINGS = [
  {
    property: 'qasr-al-sharq-malki',
    unit: 0,
    status: 'confirmed',
    nights: 3,
    inDays: 14,
  },
  {
    property: 'coastal-chalets-blouran',
    unit: 0,
    status: 'completed',
    nights: 4,
    inDays: -30,
  },
  { property: 'beit-al-yasmine', unit: 1, status: 'cancelled', nights: 2, inDays: -7 },
  {
    property: 'qasr-al-sharq-apartments',
    unit: 0,
    status: 'pending_confirmation',
    nights: 5,
    inDays: 21,
  },
] as const;

function money(value: number): string {
  return value.toFixed(2);
}

function isoDate(offsetDays: number): string {
  const date = new Date();

  date.setUTCDate(date.getUTCDate() + offsetDays);

  return date.toISOString().slice(0, 10);
}

/**
 * Everything here runs against either the pool or a transaction on it.
 *
 * Stated as a type rather than left to inference so the transaction wrapper below cannot be
 * undone by someone adding a call that only the pool supports.
 */
type Seeder = Database | Transaction;

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];

  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  const db = createDatabase(databaseUrl, 2);

  try {
    /*
      One transaction over the clear AND the seed.

      This script deletes the previous fixtures before writing the new ones, so a failure in the
      middle used to leave a database with neither: a run that stopped on a foreign key left the
      console with no disputes and no message threads, and the e2e suite then reported that as a
      product regression. Rolled back, a failed seed leaves exactly what was there before, and the
      only thing lost is the time.
    */
    await db.transaction(async (tx) => {
      await build(tx);
    });
  } finally {
    await db.$client.end();
  }
}

/**
 * The fixture TOTP secret, encrypted the way the API encrypts it.
 *
 * Built per call rather than held in a module constant so the script fails loudly at the point of
 * use if `FIELD_ENCRYPTION_KEY` is absent, rather than at import time with a stack trace that says
 * nothing about seeding.
 */
function encryptedPartnerSecret(): string {
  const key = process.env['FIELD_ENCRYPTION_KEY'];

  if (!key) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY is required: the fixture partners enrol a second factor, and it is ' +
        'stored encrypted exactly as a real enrolment stores it.',
    );
  }

  return new FieldEncryptionService({ FIELD_ENCRYPTION_KEY: key } as Env).encrypt(
    PARTNER_TOTP_SECRET,
  );
}

/**
 * Creates the account, or refreshes the one already there.
 *
 * Keyed on email. See the note above about why these are never deleted: an account that has signed
 * in is pinned by the append-only audit log, and its history is worth more than a clean insert.
 */
async function upsertUser(
  db: Seeder,
  values: {
    email: string;
    phone: string;
    passwordHash: string;
    role:
      'partner' | 'customer' | 'support_agent' | 'finance_officer' | 'operations_manager';
    status?: 'active' | 'suspended';
  },
): Promise<{ id: string }> {
  const existing = await db.execute<{ id: string }>(
    sql`SELECT id FROM users WHERE lower(email) = ${values.email.toLowerCase()} LIMIT 1`,
  );

  const found = existing.rows[0];

  if (found) {
    await db.execute(sql`
      UPDATE users
      SET password_hash = ${values.passwordHash},
          role = ${values.role}::user_role,
          status = ${values.status ?? 'active'}::user_status,
          phone = ${values.phone},
          email_verified_at = now(),
          deleted_at = NULL,
          updated_at = now()
      WHERE id = ${found.id}
    `);

    return found;
  }

  const [row] = await db
    .insert(schema.users)
    .values({
      email: values.email,
      phone: values.phone,
      passwordHash: values.passwordHash,
      role: values.role,
      status: values.status ?? 'active',
      preferredLocale: 'ar',
      emailVerifiedAt: new Date(),
    })
    .returning();

  if (!row) throw new Error(`Could not create ${values.email}`);

  return row;
}

async function build(db: Seeder): Promise<void> {
  /* The platform's own hasher, so a fixture account is hashed exactly like a real one. */
  const passwordHash = await new PasswordService().hash(PASSWORD);

  const cities = await db.select().from(schema.cities);
  const currencies = await db.select().from(schema.currencies);
  const propertyTypes = await db.select().from(schema.propertyTypes);
  const partnerTypes = await db.select().from(schema.partnerTypes);
  const policies = await db.select().from(schema.cancellationPolicies);

  const cityBySlug = new Map(cities.map((c) => [c.slug, c]));
  const typeByCode = new Map(propertyTypes.map((t) => [t.code, t]));
  const partnerTypeByCode = new Map(partnerTypes.map((t) => [t.code, t]));
  const usd = currencies.find((c) => c.code === 'USD');
  const policy = policies[0];

  if (!usd) throw new Error('USD is missing — run `pnpm db:seed` first.');
  if (!policy) throw new Error('No cancellation policy — run `pnpm db:seed` first.');

  const emails = [...PARTNERS.map((p) => p.email), CUSTOMER.email];
  /*
    A parameterised IN list. `${array}` in a drizzle template expands to `($1, $2, …)`, which is an
    IN list and NOT an array literal — so `= ANY(${emails}::text[])` builds `ANY(($1,$2,…)::text[])`
    and Postgres rejects it. Written out so the shape is obvious rather than surprising.
  */
  const emailList = sql.join(
    emails.map((email) => sql`${email}`),
    sql`, `,
  );

  /*
    Idempotent, and ordered by the foreign keys rather than by intuition.

    Everything this script creates is reachable from two facts: the partner accounts own the
    properties, and every account it makes has an `@safra.test` address in a known shape. Guests
    have NO user row at all — a guest profile is the point of `is_guest` — so a cleanup that joined
    through `users` would leave them and then fail on the next run, which is exactly what happened.
  */
  const testbedProfiles = sql`
    SELECT cp.id FROM customer_profiles cp
    WHERE cp.email IN (${emailList})
       OR cp.email LIKE 'guest%@safra.test'`;
  const testbedBookings = sql`
    SELECT b.id FROM bookings b
    WHERE b.customer_profile_id IN (${testbedProfiles})
       OR b.partner_id IN (
            SELECT pa.id FROM partners pa JOIN users u ON u.id = pa.user_id
            WHERE lower(u.email) IN (${emailList}))`;

  await db.execute(sql`DELETE FROM refunds WHERE booking_id IN (${testbedBookings})`);
  await db.execute(sql`DELETE FROM payment_provider_events WHERE payment_id IN (
    SELECT id FROM payments WHERE booking_id IN (${testbedBookings}))`);
  await db.execute(sql`DELETE FROM payments WHERE booking_id IN (${testbedBookings})`);
  /*
    TRUNCATE, not DELETE. `messages` is append-only by trigger — a SEVENTH table alongside the six
    `reset-dev` names — so a row-wise delete raises `insufficient_privilege`, a conversation cannot
    be removed while its messages point at it, and that in turn pins the booking.

    Since 2026-08-07 `messages` also refuses TRUNCATE — a `BEFORE TRUNCATE` statement trigger
    closed the hole this used to rely on — so the suspension is explicit and scoped to this
    transaction. It clears every thread rather than only this script's, which is acceptable for the
    reason it would not be in the seed: nothing but a testbed has threads on this database.
  */
  await db.execute(sql`ALTER TABLE messages DISABLE TRIGGER USER`);
  await db.execute(sql`TRUNCATE TABLE messages, conversations RESTART IDENTITY`);
  await db.execute(sql`ALTER TABLE messages ENABLE TRIGGER USER`);
  /*
    Notifications go FIRST, before the four things they point at.

    `notifications` carries a nullable foreign key to each of `bookings`, `disputes`,
    `customer_profiles` and `partners`, so it pins all four — and it is the only table in this
    cleanup that has to be cleared before `disputes` rather than after. Every row this deletes was
    written BY the testbed: a fixture booking's confirmation, a fixture dispute's acknowledgement.

    It was missing, and the failure it caused named none of this. `db:testbed` stopped on
    «Failed query: DELETE FROM customer_profiles» — the same truncated, unhelpful message the gift
    card tables produced when they were missed — and because the clear and the seed share one
    transaction, the rollback left the database looking untouched. So the symptom was a reset that
    reported an error and changed nothing, on a suite whose gift-card spec needs the reset to run.
  */
  await db.execute(sql`DELETE FROM notifications
    WHERE customer_profile_id IN (${testbedProfiles})
       OR booking_id IN (${testbedBookings})
       OR partner_id IN (
            SELECT pa.id FROM partners pa JOIN users u ON u.id = pa.user_id
            WHERE lower(u.email) IN (${emailList}))
       OR dispute_id IN (SELECT id FROM disputes WHERE booking_id IN (${testbedBookings}))`);

  await db.execute(sql`DELETE FROM dispute_evidence WHERE dispute_id IN (
    SELECT id FROM disputes WHERE booking_id IN (${testbedBookings}))`);
  await db.execute(sql`DELETE FROM disputes WHERE booking_id IN (${testbedBookings})`);

  /*
    Reviews pin the bookings they are about, so they go first.

    P-006 forbids DELETE and a trigger enforces it — so this is the one cleanup step that cannot
    simply delete. `reviews` is NOT one of the seven append-only tables, so TRUNCATE still works on
    it without a suspension. Acceptable for the same reason as the threads above: nothing but a
    testbed has reviews on this database, and the alternative is a seed that can never re-run.
  */
  await db.execute(sql`TRUNCATE TABLE reviews`);

  /*
    Payouts pin the bookings they cover, so they go before the bookings do.

    A PAID payout is money that left the company, and `deny_paid_payout_mutation` refuses to delete
    one — correctly, and including here. So this stops with an instruction rather than an
    `insufficient_privilege` from a trigger nobody was expecting: clearing a database that has paid
    transfers on it is `db:reset-dev`'s job, because only TRUNCATE gets past an append-only rule and
    only that script is guarded well enough to be allowed to.
  */
  const paid = await db.execute<{ reference: string }>(sql`
    SELECT p.reference FROM partner_payouts p
    WHERE p.status = 'paid'
      AND p.id IN (SELECT payout_id FROM partner_payout_items
                   WHERE booking_id IN (${testbedBookings}))`);

  if (paid.rows.length > 0) {
    throw new Error(
      `Refusing to run: ${paid.rows.length} PAID payout(s) cover bookings this script would ` +
        `delete (${paid.rows.map((r) => r.reference).join(', ')}). A paid payout is a completed ` +
        'transfer and is immutable by design. Run `pnpm db:reset-dev --yes` first, which clears ' +
        'the payout tables wholesale, then re-run this seed.',
    );
  }

  await db.execute(sql`DELETE FROM partner_payout_items
    WHERE booking_id IN (${testbedBookings})`);
  await db.execute(sql`DELETE FROM partner_payouts
    WHERE partner_id IN (
      SELECT pa.id FROM partners pa JOIN users u ON u.id = pa.user_id
      WHERE lower(u.email) IN (${emailList}))`);

  /*
    Ledger entries and wallet movements pin the bookings they belong to, and both tables are
    append-only by trigger.

    The rows are debris: integration suites post real movements against whatever bookings exist,
    and `docs/FUTURE-WORK.md` carries that as O-data-2. The seed has to clear them or it can never
    re-run on a machine where the tests have been run — which is every machine.

    The trigger is disabled for the length of this ONE statement rather than the table being
    truncated, so only the entries belonging to bookings this script is already deleting go. That
    matters: `partner_payouts.entry_group_id` points into this table, and a wholesale TRUNCATE
    would leave paid payouts claiming a movement that no longer exists — the exact reconciliation
    failure the payout detail screen was built to surface.

    Inside the seed's transaction, so a failure anywhere puts the trigger back.
  */
  await db.execute(sql`ALTER TABLE ledger_entries DISABLE TRIGGER USER`);
  await db.execute(sql`ALTER TABLE wallet_transactions DISABLE TRIGGER USER`);
  await db.execute(
    sql`DELETE FROM ledger_entries WHERE booking_id IN (${testbedBookings})`,
  );
  await db.execute(
    sql`DELETE FROM wallet_transactions WHERE booking_id IN (${testbedBookings})`,
  );
  await db.execute(sql`ALTER TABLE wallet_transactions ENABLE TRIGGER USER`);
  await db.execute(sql`ALTER TABLE ledger_entries ENABLE TRIGGER USER`);

  await db.execute(sql`DELETE FROM bookings WHERE id IN (${testbedBookings})`);

  const testbedPartners = sql`
    SELECT pa.id FROM partners pa JOIN users u ON u.id = pa.user_id
    WHERE lower(u.email) IN (${emailList})`;

  await db.execute(sql`DELETE FROM availability_days WHERE unit_id IN (
    SELECT un.id FROM units un JOIN properties pr ON pr.id = un.property_id
    WHERE pr.partner_id IN (${testbedPartners}))`);
  await db.execute(sql`DELETE FROM units WHERE property_id IN (
    SELECT id FROM properties WHERE partner_id IN (${testbedPartners}))`);
  await db.execute(sql`DELETE FROM property_images WHERE property_id IN (
    SELECT id FROM properties WHERE partner_id IN (${testbedPartners}))`);
  /*
    Favourites reference properties, so they go first.

    Added when المفضلة landed and missed here: `favourites.property_id` is a plain foreign key, so one
    saved listing on a testbed property made `db:testbed` fail on the DELETE below — and the error a
    person sees is a truncated "Failed query: DELETE FROM properties", which names neither the table
    that blocked it nor the row.
  */
  await db.execute(sql`DELETE FROM favourites WHERE property_id IN (
    SELECT id FROM properties WHERE partner_id IN (${testbedPartners}))
    OR customer_profile_id IN (${testbedProfiles})`);
  await db.execute(sql`DELETE FROM properties WHERE partner_id IN (${testbedPartners})`);

  /*
    The last things holding a partner row down.

    `partner_violations` is written by the SLA sweep whenever a seeded booking expires unanswered,
    so it accumulates on its own rather than being something this script created. `ledger_entries`
    keeps a second reference — by PARTNER rather than by booking — on the movements a payout posts,
    which have no booking at all; the scoped delete above catches only the booking-shaped ones.
  */
  await db.execute(
    sql`DELETE FROM partner_violations WHERE partner_id IN (${testbedPartners})`,
  );
  await db.execute(sql`ALTER TABLE ledger_entries DISABLE TRIGGER USER`);
  await db.execute(
    sql`DELETE FROM ledger_entries WHERE partner_id IN (${testbedPartners})`,
  );
  await db.execute(sql`ALTER TABLE ledger_entries ENABLE TRIGGER USER`);
  /*
    Support threads and their messages.

    Every browser run opens a real ticket — the e2e specs must, because reusing an existing thread would
    stop exercising the OPEN path — so without this they accumulate one per run and clutter the console's
    inbox for good. `messages` is append-only by trigger, like the ledger and the wallet statement, so the
    trigger comes off for the same reason: the immutability protects PRODUCTION evidence, and a testbed
    reset is not that.
  */
  await db.execute(sql`ALTER TABLE messages DISABLE TRIGGER USER`);
  await db.execute(sql`DELETE FROM messages WHERE conversation_id IN (
    SELECT c.id FROM conversations c
    WHERE c.customer_profile_id IN (${testbedProfiles})
       OR c.partner_id IN (${testbedPartners}))`);
  await db.execute(sql`ALTER TABLE messages ENABLE TRIGGER USER`);
  await db.execute(sql`DELETE FROM conversations
    WHERE customer_profile_id IN (${testbedProfiles})
       OR partner_id IN (${testbedPartners})`);

  /*
    The gift cards a testbed customer bought, and their history.

    `gift_card_transactions` is append-only by trigger like the ledger and the wallet statement, so the
    trigger comes off for the same reason. Both were missed when بطاقات الهدايا landed, and the symptom
    was a truncated "Failed query: DELETE FROM customer_profiles" that named nothing useful.
  */
  await db.execute(sql`ALTER TABLE gift_card_transactions DISABLE TRIGGER USER`);
  await db.execute(sql`DELETE FROM gift_card_transactions WHERE gift_card_id IN (
    SELECT id FROM gift_cards WHERE purchased_by_customer_id IN (${testbedProfiles}))`);
  await db.execute(sql`ALTER TABLE gift_card_transactions ENABLE TRIGGER USER`);
  await db.execute(
    sql`DELETE FROM gift_cards WHERE purchased_by_customer_id IN (${testbedProfiles})`,
  );

  /*
    Wallet transactions are append-only by trigger, so the trigger comes off to clear them — exactly
    what this script already does for `ledger_entries` a few lines up, and for the same reason: the
    immutability is there to protect PRODUCTION evidence, and a testbed reset is not that.
    
    This is why the wallet used to be seeded as a bare balance with no history behind it. That worked
    until محفظتي started deriving how much of a balance came from a gift card by reading these rows —
    money with no transaction behind it is money the derivation cannot attribute.
  */
  await db.execute(sql`ALTER TABLE wallet_transactions DISABLE TRIGGER USER`);
  await db.execute(sql`DELETE FROM wallet_transactions WHERE wallet_id IN (
    SELECT id FROM wallets WHERE customer_profile_id IN (${testbedProfiles}))`);
  await db.execute(sql`ALTER TABLE wallet_transactions ENABLE TRIGGER USER`);
  await db.execute(
    sql`DELETE FROM wallets WHERE customer_profile_id IN (${testbedProfiles})`,
  );
  await db.execute(sql`DELETE FROM customer_profiles WHERE id IN (${testbedProfiles})`);

  /*
    Any partnership REQUEST that produced one of these partners, and the calls logged on it.

    A request keeps `partner_id` pointing at what it became, so a testbed partner that was created
    by ACCEPTING a request cannot be deleted while the request survives — and the seed died on
    exactly that with a truncated `Failed query: DELETE FROM partners`.

    It is not hypothetical: a tester who accepts the seeded request in the console turns
    `customer@safra.test` into a partner, and from that moment `db:testbed` could not be run again
    (Bashar, 2026-08-20). The seed already anticipates that acceptance a few lines further down,
    where it soft-deletes the partner a previous run created; this is the same event, one foreign
    key earlier.

    Deleted rather than unlinked. A request whose partner is being removed describes something that
    no longer exists, and leaving it would put a row in «طلبات الشراكة» pointing at nothing.
  */
  await db.execute(sql`DELETE FROM partner_application_contacts
    WHERE application_id IN (
      SELECT id FROM partner_applications WHERE partner_id IN (${testbedPartners}))`);
  await db.execute(
    sql`DELETE FROM partner_applications WHERE partner_id IN (${testbedPartners})`,
  );

  await db.execute(sql`DELETE FROM partners WHERE id IN (${testbedPartners})`);
  /*
    Users are REUSED, not deleted.

    Signing in writes an `audit_log` row, and `audit_log` is append-only — so the second run after
    anybody has actually used the testbed hit `audit_log_actor_user_id_users_id_fk` and could not
    proceed. That is `O-data-1` in `docs/FUTURE-WORK.md` meeting its own author.

    Reusing the row is better than working around the constraint: the account keeps its identity,
    its audit history stays true, and everything that hangs off it — partners, properties, bookings
    — is rebuilt fresh above. Sessions still go, so a stale token cannot outlive the rebuild.
  */
  const testbedUsers = sql`
    SELECT id FROM users
    WHERE lower(email) IN (${emailList})
       OR email LIKE 'guest%@safra.test'
       OR email LIKE 'staff%@safra.test'`;

  await db.execute(sql`DELETE FROM refresh_tokens WHERE user_id IN (${testbedUsers})`);
  await db.execute(sql`DELETE FROM auth_tokens WHERE user_id IN (${testbedUsers})`);
  await db.execute(
    sql`DELETE FROM staff_scope_cities WHERE user_id IN (${testbedUsers})`,
  );

  // ── The three partners ────────────────────────────────────────────────────
  const madeProperties = new Map<
    string,
    { id: string; partnerId: string; cityId: string; status: string }
  >();
  const madeUnits = new Map<string, { id: string; price: number }[]>();

  for (const spec of PARTNERS) {
    const city = cityBySlug.get(spec.citySlug);
    const partnerType = partnerTypeByCode.get(spec.type);

    if (!city || !partnerType)
      throw new Error(`Missing reference data for ${spec.email}`);

    const user = await upsertUser(db, {
      email: spec.email,
      phone: spec.phone,
      passwordHash,
      role: 'partner',
    });

    /*
      The second factor, set here rather than by the suite.

      Written with the platform's own `FieldEncryptionService`, so the stored column is encrypted
      exactly as a real enrolment leaves it — a fixture that wrote the secret in the clear would
      pass every test and prove nothing about the code path that reads it back.

      Recovery codes are deliberately left empty. They are Argon2id hashes of values shown once,
      and a fixture cannot produce a code somebody could actually use without also storing it
      somewhere; the recovery path is covered by `partner-two-factor.integration.test.ts`, which
      generates and consumes real ones.
    */
    /*
      Every fixture partner is UNENROLLED since 2026-08-20 (Bashar).

      A partner's second factor is a code emailed at every sign-in; an authenticator is an upgrade
      they may choose. Seeding one would put the fixtures on a path almost no real partner takes,
      and — worse — the browser suite would silently keep exercising the TOTP form while the
      emailed-code form, which is what every partner actually meets, went untested.

      `twoFactorEnrolled` survives as a flag because a fixture that DOES enrol is still worth
      having the day somebody tests the opt-in. Nothing sets it today.
    */
    await db.execute(sql`
      UPDATE users
      SET totp_secret_encrypted = ${spec.twoFactorEnrolled ? encryptedPartnerSecret() : null},
          totp_enabled_at = ${spec.twoFactorEnrolled ? sql`now()` : sql`NULL`},
          totp_recovery_code_hashes = '{}'
      WHERE id = ${user.id}
    `);

    /*
      No `rating` and no `reviews_count`.

      They used to be literals in each fixture — `rating: '4.9', reviewsCount: 118` — and the
      result was a published listing showing «★ ٤٫٩ من ١١٨ تقييماً» with not one review behind it.
      A trigger has owned both columns since reviews shipped; letting the fixture declare them
      produced a number no review could explain, on the screen a customer uses to decide.

      Now a property's rating is whatever its reviews say, and a property with none has none.

      Approved AND screened. `sanctions_screened_at` matters: the console refuses to approve a
      partner that has not been screened, so a fixture that skipped it would create a partner the
      console would treat as half-finished.
    */
    const [partner] = await db
      .insert(schema.partners)
      .values({
        id: spec.id,
        userId: user.id,
        partnerTypeId: partnerType.id,
        legalName: spec.legalName,
        displayName: spec.displayName,
        cityId: city.id,
        address: spec.address,
        phone: spec.phone,
        email: spec.email,
        verification: 'approved',
        verifiedAt: new Date(),
        sanctionsScreenedAt: new Date(),
        sanctionsScreeningResult: { matches: [], source: 'testbed' },
        score: spec.score,
        tier: spec.tier,
      })
      .returning();

    if (!partner) throw new Error(`Could not create partner for ${spec.email}`);

    for (const property of spec.properties) {
      const propertyCity = cityBySlug.get(property.citySlug);
      // No fallback: an unknown code must FAIL, not quietly become whichever type is first.
      const propertyType = typeByCode.get(property.type);

      if (!propertyCity || !propertyType) {
        throw new Error(`Missing reference data for ${property.slug}`);
      }

      const [row] = await db
        .insert(schema.properties)
        .values({
          partnerId: partner.id,
          cityId: propertyCity.id,
          propertyTypeId: propertyType.id,
          slug: property.slug,
          nameAr: property.nameAr,
          nameEn: property.nameEn,
          nameDe: property.nameEn,
          descriptionAr: property.descriptionAr,
          descriptionEn: property.descriptionAr,
          descriptionDe: property.descriptionAr,
          address: property.address,
          status: property.status ?? 'published',
          ...(property.reviewNotes ? { reviewNotes: property.reviewNotes } : {}),
          /* Only a published listing has been verified; a draft claiming a date would be a lie. */
          ...((property.status ?? 'published') === 'published'
            ? { verifiedAt: new Date() }
            : {}),
          cancellationPolicyId: policy.id,
          attributes: [...property.attributes],
          /* No rating or count — a trigger owns both. See the note above the partner insert. */
        })
        .returning();

      if (!row) throw new Error(`Could not create ${property.slug}`);

      madeProperties.set(property.slug, {
        id: row.id,
        partnerId: partner.id,
        cityId: propertyCity.id,
        /* Carried so the bulk booking generator can skip what was never bookable. */
        status: property.status ?? 'published',
      });

      const units: { id: string; price: number }[] = [];

      /*
        Room numbers that look like room numbers: 101, 102 … then 201 on the next floor.

        The testbed exists to show the screens as an operator will meet them, and «رقم الوحدة» on
        every row of التقويمات is one of those screens. Sequential 1, 2, 3 would technically fill
        the column while teaching nothing about how it reads against real labels.
      */
      let unitIndex = 0;

      for (const unit of property.units) {
        const floor = Math.floor(unitIndex / 4) + 1;
        const room = `${floor}0${(unitIndex % 4) + 1}`;

        unitIndex += 1;

        const [made] = await db
          .insert(schema.units)
          .values({
            propertyId: row.id,
            nameAr: unit.nameAr,
            nameEn: unit.nameEn,
            nameDe: unit.nameEn,
            maxGuests: unit.maxGuests,
            basePrice: money(unit.price),
            currencyId: usd.id,
            unitLabel: room,
          })
          .returning();

        if (made) units.push({ id: made.id, price: unit.price });
      }

      madeUnits.set(property.slug, units);
    }
  }

  // ── The customer ──────────────────────────────────────────────────────────
  const customerUser = await upsertUser(db, {
    email: CUSTOMER.email,
    phone: CUSTOMER.phone,
    passwordHash,
    role: 'customer',
  });

  /*
    The applicant, created and then left entirely alone — no profile, no partner, no booking.
    Its whole value is what it does NOT have. See `APPLICANT`.

    Reset FIRST, and for the same reason the `request-*` fixtures are: somebody who walks the
    journey turns this account into a partner, correctly, and a second walk would then be refused
    with «هذا البريد شريك بالفعل» — an account cannot apply twice. Re-running `db:testbed` has to
    hand the journey back, or it can only ever be rehearsed once per database.
  */
  const applicantUser = await db.execute<{ id: string }>(
    sql`SELECT id FROM users WHERE lower(email) = ${APPLICANT.email} LIMIT 1`,
  );

  const applicantId = applicantUser.rows[0]?.id;

  if (applicantId) {
    await db.execute(sql`
      DELETE FROM partner_application_contacts
      WHERE application_id IN (
        SELECT id FROM partner_applications WHERE lower(email) = ${APPLICANT.email})
    `);
    await db.execute(
      sql`DELETE FROM partner_applications WHERE lower(email) = ${APPLICANT.email}`,
    );

    /* Soft-deleted, never dropped — P-003, and it is what frees `partners_user_unique`. */
    await db.execute(sql`
      UPDATE partners SET deleted_at = now()
      WHERE deleted_at IS NULL AND user_id = ${applicantId}::uuid
    `);
  }

  const applicant = await upsertUser(db, {
    email: APPLICANT.email,
    phone: APPLICANT.phone,
    passwordHash,
    role: 'customer',
  });

  /*
    The profile and the wallet a registration would have left, and nothing else — no booking, no
    review, no gift card. `ON CONFLICT DO NOTHING` because a re-run must not duplicate them and
    must not disturb one a tester has since edited on «ملفي الشخصي».
  */
  await db.execute(sql`
    INSERT INTO customer_profiles
      (user_id, full_name, email, phone, preferred_locale, preferred_currency_id, gender, is_guest)
    SELECT ${applicant.id}::uuid, ${APPLICANT.fullName}, ${APPLICANT.email},
           ${APPLICANT.phone}, 'ar', ${usd.id}::uuid, 'undisclosed', false
    WHERE NOT EXISTS (
      SELECT 1 FROM customer_profiles WHERE user_id = ${applicant.id}::uuid AND deleted_at IS NULL)
  `);

  await db.execute(sql`
    INSERT INTO wallets (customer_profile_id, balance, currency_id)
    SELECT cp.id, '0', ${usd.id}::uuid
    FROM customer_profiles cp
    WHERE cp.user_id = ${applicant.id}::uuid AND cp.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM wallets w WHERE w.customer_profile_id = cp.id)
  `);

  const [profile] = await db
    .insert(schema.customerProfiles)
    .values({
      id: FIXTURE_CUSTOMER_PROFILE_ID,
      userId: customerUser.id,
      fullName: CUSTOMER.fullName,
      email: CUSTOMER.email,
      phone: CUSTOMER.phone,
      preferredCurrencyId: usd.id,
      isGuest: false,
    })
    .returning();

  if (!profile) throw new Error('Could not create the customer profile.');

  /*
    The opening balance is seeded WITH the transaction that explains it.

    Every movement the app makes writes a `wallet_transactions` row, so `balance` always equals the sum
    of its history — and محفظتي now relies on that: it derives how much of the balance came from a gift
    card by walking those rows. A balance set directly, with nothing behind it, is money the derivation
    cannot attribute, so it read «الرصيد الحالي ٠$» beside «رصيد بطاقات الهدايا ٣٥$» on a wallet that had
    never seen a gift card.

    `sla_compensation` because that is what an opening testbed balance represents: goodwill credit.
  */
  const [seededWallet] = await db
    .insert(schema.wallets)
    .values({
      customerProfileId: profile.id,
      currencyId: usd.id,
      balance: WALLET_OPENING_BALANCE,
    })
    .returning();

  if (!seededWallet) throw new Error('Could not create the wallet.');

  await db.insert(schema.walletTransactions).values({
    walletId: seededWallet.id,
    direction: 'credit',
    reason: 'sla_compensation',
    amount: WALLET_OPENING_BALANCE,
    currencyId: usd.id,
    balanceAfter: WALLET_OPENING_BALANCE,
  });

  // ── The bookings ──────────────────────────────────────────────────────────
  for (const spec of BOOKINGS) {
    const property = madeProperties.get(spec.property);
    const units = madeUnits.get(spec.property);
    const unit = units?.[spec.unit];

    if (!property || !unit) throw new Error(`No unit for ${spec.property}`);

    const base = unit.price * spec.nights;
    const commission = Math.round(base * COMMISSION_RATE * 100) / 100;
    const total = Math.round((base + CUSTOMER_FEE) * 100) / 100;
    const checkIn = isoDate(spec.inDays);
    const checkOut = isoDate(spec.inDays + spec.nights);
    const paid = spec.status !== 'pending_confirmation';

    await db.insert(schema.bookings).values({
      customerProfileId: profile.id,
      unitId: unit.id,
      propertyId: property.id,
      partnerId: property.partnerId,
      cityId: property.cityId,
      checkIn,
      checkOut,
      guestsAdults: 2,
      status: spec.status,
      baseAmount: money(base),
      customerFeeValue: money(CUSTOMER_FEE),
      customerFeeAmount: money(CUSTOMER_FEE),
      partnerCommissionRate: COMMISSION_RATE.toFixed(4),
      partnerCommissionAmount: money(commission),
      totalAmount: money(total),
      partnerPayableAmount: money(base - commission),
      currencyId: usd.id,
      fxRateToSyp: FX_RATE_TO_SYP.toFixed(8),
      totalSyp: money(total * FX_RATE_TO_SYP),
      cancellationPolicySnapshot: { code: policy.code, tiers: [] },
      ...(paid ? { paidAt: new Date() } : {}),
      /*
        The SLA clock, set the way `BookingCreationService` sets it.

        A `pending_confirmation` booking with no `confirmation_deadline_at` is a booking the SLA
        sweep can never expire and never fine — so a testbed full of them could not exercise the
        two-hour rule at all, and the partner dashboard's countdown had nothing to count. Ahead of
        now rather than behind it, so the queue is a live queue rather than a pile the next sweep
        deletes.
      */
      ...(spec.status === 'pending_confirmation'
        ? {
            confirmationDeadlineAt: new Date(
              Date.now() + CONFIRMATION_WINDOW_MINUTES * 60_000,
            ),
          }
        : {}),
      ...(spec.status === 'confirmed' || spec.status === 'completed'
        ? { confirmedAt: new Date() }
        : {}),
      ...(spec.status === 'cancelled'
        ? { cancelledAt: new Date(), cancellationReason: 'system.partner_rejected' }
        : {}),
    });
  }

  await bulk(db, {
    profileId: profile.id,
    usd,
    policy,
    madeProperties,
    madeUnits,
    passwordHash,
  });
  await report(db);
}

/**
 * Volume, so the console is a working console rather than a demo.
 *
 * Four bookings prove the states; they cannot show a second page, a filter that narrows anything,
 * or a payments registry. Bashar asked for the three partners to carry data "similar to the current
 * data" — the point of clearing 5,250 test bookings was to remove NOISE, not to end up with a
 * console that no screen can be judged on.
 *
 * Everything here belongs to the three partners, so it is all recognisable: a guest is a name, a
 * booking is one of theirs, and nothing arrives from a test run nobody remembers.
 */
async function bulk(
  db: Seeder,
  ctx: {
    profileId: string;
    usd: { id: string };
    policy: { id: string; code: string };
    madeProperties: Map<
      string,
      { id: string; partnerId: string; cityId: string; status: string }
    >;
    madeUnits: Map<string, { id: string; price: number }[]>;
    passwordHash: string;
  },
): Promise<void> {
  const GUEST_NAMES = [
    'سامر الخطيب',
    'رنا عبد الله',
    'فادي مرعي',
    'هبة النجار',
    'وليد بركات',
    'مها الأحمد',
    'طارق زيدان',
    'نور الدين حلاق',
    'ديما شاهين',
    'كرم العلي',
    'سلمى درويش',
    'أيهم قاسم',
    'لينا صالح',
    'بشار منصور',
    'ريم الحاج',
    'عمر التلاوي',
  ];

  const profiles: string[] = [ctx.profileId];

  for (const [index, name] of GUEST_NAMES.entries()) {
    const [row] = await db
      .insert(schema.customerProfiles)
      .values({
        fullName: name,
        email: `guest${index + 1}@safra.test`,
        phone: `+96395500${String(index + 10).padStart(4, '0')}`,
        preferredCurrencyId: ctx.usd.id,
        isGuest: true,
      })
      .returning();

    if (row) profiles.push(row.id);
  }

  /* Six staff accounts, so الموظفون is a registry rather than a single row. */
  /*
    Twelve, so الموظفون and the scope map beneath it are both registries with more than one page.
    `/staff` is the one route carrying TWO paged tables, and the property worth testing there —
    that they page independently — cannot be seen at all with a single page each.
  */
  const ROLES = [
    'support_agent',
    'support_agent',
    'support_agent',
    'support_agent',
    'support_agent',
    'support_agent',
    'support_agent',
    'support_agent',
    'finance_officer',
    'finance_officer',
    'operations_manager',
    'support_agent',
  ] as const;

  for (const [index, role] of ROLES.entries()) {
    await upsertUser(db, {
      email: `staff${index + 1}@safra.test`,
      phone: `+96393300${String(index + 10).padStart(4, '0')}`,
      passwordHash: ctx.passwordHash,
      role,
      status: index === 5 ? 'suspended' : 'active',
    });
  }

  /*
    Bulk history is generated against PUBLISHED listings only.

    A draft has never been visible to a customer, so it cannot have accumulated ninety days of
    completed stays — and once it had them, the review seeder distributed reviews to it and a
    trigger gave it a public-looking star rating. Two fixture falsehoods from one missing filter.

    The consequence is also practical: with drafts in the rotation, the published listings the
    customer-facing tests read got a third of the bookings they used to, and reviews bunched onto
    whichever listing happened to keep enough of them.
  */
  const slugs = [...ctx.madeProperties.entries()]
    .filter(([, property]) => property.status === 'published')
    .map(([slug]) => slug);
  const STATUSES = [
    'confirmed',
    'confirmed',
    'completed',
    'completed',
    'completed',
    'pending_confirmation',
    'pending_payment',
    'cancelled',
  ] as const;

  /*
    A cursor PER UNIT, because the database will not allow two live bookings to overlap on one
    unit — an exclusion constraint over `daterange(check_in, check_out)` (post/0001_constraints).
    The first version of this generator picked dates from the loop index and was rejected on the
    first collision, which is the constraint doing exactly its job: the double-booking guarantee is
    absolute, and a fixture does not get an exemption from it.

    Each unit therefore walks its own calendar forward from 70 days ago, so a unit accumulates a
    plausible history of past stays and a few upcoming ones rather than an impossible pile.
  */
  const cursor = new Map<string, number>();

  let n = 0;

  for (let i = 0; i < 84; i += 1) {
    const slug = slugs[i % slugs.length];
    const property = slug ? ctx.madeProperties.get(slug) : undefined;
    const units = slug ? ctx.madeUnits.get(slug) : undefined;
    const unit = units?.[i % Math.max(1, units.length)];
    const profileId = profiles[i % profiles.length];

    if (!property || !unit || !profileId) continue;

    const status = STATUSES[i % STATUSES.length] ?? 'confirmed';
    const nights = (i % 5) + 1;
    const offset = cursor.get(unit.id) ?? -70;

    // Next booking on this unit starts after this one ends, plus a gap.
    cursor.set(unit.id, offset + nights + 2);
    const base = unit.price * nights;
    const commission = Math.round(base * COMMISSION_RATE * 100) / 100;
    const total = Math.round((base + CUSTOMER_FEE) * 100) / 100;
    const paid = status !== 'pending_payment' && status !== 'pending_confirmation';

    const [booking] = await db
      .insert(schema.bookings)
      .values({
        customerProfileId: profileId,
        unitId: unit.id,
        propertyId: property.id,
        partnerId: property.partnerId,
        cityId: property.cityId,
        checkIn: isoDate(offset),
        checkOut: isoDate(offset + nights),
        guestsAdults: (i % 3) + 1,
        status,
        baseAmount: money(base),
        customerFeeValue: money(CUSTOMER_FEE),
        customerFeeAmount: money(CUSTOMER_FEE),
        partnerCommissionRate: COMMISSION_RATE.toFixed(4),
        partnerCommissionAmount: money(commission),
        totalAmount: money(total),
        partnerPayableAmount: money(base - commission),
        currencyId: ctx.usd.id,
        fxRateToSyp: FX_RATE_TO_SYP.toFixed(8),
        totalSyp: money(total * FX_RATE_TO_SYP),
        cancellationPolicySnapshot: { code: ctx.policy.code, tiers: [] },
        ...(paid ? { paidAt: new Date(), confirmedAt: new Date() } : {}),
        /* The SLA clock — see the note on the hand-built bookings above. */
        ...(status === 'pending_confirmation'
          ? {
              confirmationDeadlineAt: new Date(
                Date.now() + CONFIRMATION_WINDOW_MINUTES * 60_000,
              ),
            }
          : {}),
        ...(status === 'cancelled'
          ? { cancelledAt: new Date(), cancellationReason: 'system.payment_expired' }
          : {}),
      })
      .returning();

    if (!booking) continue;

    n += 1;

    if (paid) {
      await db.insert(schema.payments).values({
        bookingId: booking.id,
        method: i % 4 === 0 ? 'sham_cash' : 'visa',
        provider: 'simulator',
        amount: money(total),
        currencyId: ctx.usd.id,
        status: 'captured',
        capturedAt: new Date(),
      });
    }
  }

  console.log(`  ${n} additional bookings`);

  await conversation(db, ctx.profileId);
  await reviews(db);
  await partnershipRequests(db);
}

/**
 * «طلبات الشراكة» — one request in each state (Bashar, 2026-08-19).
 *
 * Four rows, because the queue's whole point is that its four statuses are four colours and four
 * words, and `navigation.spec.ts` sweeps every section asserting exactly that. A section seeded
 * with only `submitted` rows would pass the sweep by having nothing to collide with.
 *
 * The accepted one is linked to a REAL partner, so the detail screen's «أصبح الشريك» line has
 * something to point at and the return trip from it can be tested.
 */
async function partnershipRequests(db: Seeder): Promise<void> {
  /* The platform's own hasher, so a fixture account is hashed exactly like a real one. */
  const passwordHash = await new PasswordService().hash(PASSWORD);

  const [partnerType] = await db.select().from(schema.partnerTypes).limit(1);
  const [city] = await db.select().from(schema.cities).limit(1);
  const [partner] = await db.select().from(schema.partners).limit(1);

  if (!partnerType || !city) return;

  const base = {
    partnerTypeId: partnerType.id,
    cityId: city.id,
    address: 'شارع الاختبار، بناء 12',
    phone: '+963116414444',
    preferredLocale: 'ar',
  };

  const emails = [
    'request-new@safra.test',
    'request-called@safra.test',
    'request-accepted@safra.test',
    'request-rejected@safra.test',
  ];

  /*
    Cleared first, so `db:testbed` can be run twice.

    `partner_applications_open_email_unique` allows ONE open request per address, which is the
    right rule and makes a plain re-insert fail — and this script is re-run constantly. There is
    no natural key to `ON CONFLICT` on either: the index is PARTIAL, so it only covers the two
    open statuses. Deleting these four fixture addresses is unambiguous, and it also resets a
    request that somebody accepted by hand while testing the screen.
  */
  /*
    The call log FIRST, because the applications below cannot go while it references them.

    `partner_application_contacts` has a plain foreign key, NOT `ON DELETE CASCADE`, and that is
    deliberate: P-003 forbids hard deletes, so the only thing that ever removes an application is
    this fixture reset. A cascade would exist solely to serve this line while quietly arranging for
    any future accidental `DELETE` to take a call history with it. Better that such a delete fails
    loudly and that the one place allowed to do it says so.
  */
  /* `IN ${array}` — drizzle expands a JS array to a TUPLE, never to an array literal. */
  await db.execute(sql`
    DELETE FROM partner_application_contacts
    WHERE application_id IN (SELECT id FROM partner_applications WHERE email IN ${emails})
  `);
  await db.execute(sql`DELETE FROM partner_applications WHERE email IN ${emails}`);

  /*
    And the PARTNER a previous run may have created from one of them.

    A tester who accepts the seeded request in the console turns that applicant into a partner —
    correctly. Re-seeding would then produce a fixture the console refuses with «هذا البريد شريك
    بالفعل», because an account cannot apply twice, and the queue would look broken.

    Soft-deleted, never dropped: P-003 forbids hard deletes and every scoping query already reads
    `deleted_at IS NULL`, so this is the same disappearance the rest of the platform means by it.
  */
  await db.execute(sql`
    UPDATE partners SET deleted_at = now()
    WHERE deleted_at IS NULL
      AND user_id IN (SELECT id FROM users WHERE email IN ${emails})
  `);

  /*
    Every request needs an ACCOUNT behind it (Bashar, 2026-08-19).

    Applying requires a session, so a fixture with `submitted_by_user_id` null would be a row the
    console cannot accept — the screen would offer a button that always fails. One customer per
    request, with the shared testbed password, so a tester can also sign in as one and watch their
    own account become a partner.
  */
  const applicants = await Promise.all(
    emails.map((email) =>
      upsertUser(db, {
        email,
        phone: '+963116414444',
        passwordHash,
        role: 'customer',
      }),
    ),
  );

  /**
   * A moment N days ago.
   *
   * Requests that have been WORKED are back-dated, because a call cannot precede the request it is
   * about. Seeded straight at `now()` the history read «وصل الطلب 20-08» above «تم الاتصال 14-08»,
   * a fixture describing something impossible — which this seed is explicit elsewhere about
   * refusing to do.
   */
  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const requests = await db
    .insert(schema.partnerApplications)
    .values([
      {
        ...base,
        status: 'submitted' as const,
        submittedByUserId: applicants[0]?.id,
        contactName: 'سامر الحلبي',
        email: 'request-new@safra.test',
        legalName: 'شركة الحلبي للضيافة',
        displayName: 'نُزل الحلبي',
        propertyCount: 3,
        message: 'لدينا ثلاثة مبانٍ في وسط المدينة ونرغب بعرضها على سفرة.',
      },
      {
        ...base,
        status: 'contacted' as const,
        submittedByUserId: applicants[1]?.id,
        contactName: 'ريم العطار',
        email: 'request-called@safra.test',
        legalName: 'مؤسسة العطار السياحية',
        displayName: 'شقق العطار',
        createdAt: daysAgo(9),
      },
      {
        ...base,
        status: 'accepted' as const,
        submittedByUserId: applicants[2]?.id,
        contactName: 'وليد بركات',
        email: 'request-accepted@safra.test',
        legalName: 'وليد بركات',
        displayName: 'شقق الميناء',
        createdAt: daysAgo(12),
        decidedAt: new Date(),
        decisionNotes: 'قُبل. أُرسلت الدعوة والعقد.',
        ...(partner ? { partnerId: partner.id } : {}),
      },
      {
        ...base,
        status: 'rejected' as const,
        submittedByUserId: applicants[3]?.id,
        contactName: 'خالد ن.',
        email: 'request-rejected@safra.test',
        legalName: 'غير محدد',
        displayName: 'استضافة خاصة',
        createdAt: daysAgo(5),
        decidedAt: new Date(),
        decisionNotes: 'لا يوجد ما يثبت حق التأجير، والمدينة خارج نطاق التغطية حالياً.',
      },
    ])
    .returning({
      id: schema.partnerApplications.id,
      email: schema.partnerApplications.email,
    });

  /*
    The call log, and one request deliberately has TWO calls on it.

    A partnership request is telephoned as many times as it takes, and each call leaves its own
    note — the thing the old single `contact_notes` column silently overwrote (Bashar, 2026-08-20).
    A fixture with one call each would render identically whether or not that is fixed, so
    `request-called@safra.test` carries two: the first learns the register is with the accountant,
    the second is the follow-up that got it. Opening «سجل الطلب» on that request is what shows the
    behaviour.
  */
  const idFor = (email: string) => requests.find((row) => row.email === email)?.id;
  const called = idFor('request-called@safra.test');
  const accepted = idFor('request-accepted@safra.test');

  const calls = [
    called
      ? {
          applicationId: called,
          notes:
            'اتصلنا اليوم. النشاط قائم منذ 2019، والسجل التجاري عند المحاسب وسيُرسل خلال أيام.',
          createdAt: daysAgo(6),
        }
      : null,
    called
      ? {
          applicationId: called,
          notes:
            'متابعة: وصل السجل التجاري وهو ساري حتى 2027. بقي عقد الإيجار للمبنى الثاني.',
          createdAt: daysAgo(1),
        }
      : null,
    accepted
      ? {
          applicationId: accepted,
          notes: 'مكالمة تمهيدية، كل شيء واضح.',
          createdAt: daysAgo(2),
        }
      : null,
  ].filter((call): call is NonNullable<typeof call> => call !== null);

  if (calls.length > 0) {
    await db.insert(schema.partnerApplicationContacts).values(calls);
  }

  console.log(
    `  4 partnership requests, one in each state, with ${calls.length} logged calls`,
  );
}

/**
 * Guest reviews on completed stays (§7.3).
 *
 * ## Why the seed writes these directly rather than through the service
 *
 * `ReviewService.create` requires an authenticated guest whose user id matches the booking's
 * customer profile, and most seeded bookings belong to GUEST profiles with no user row at all —
 * which is realistic and is exactly the case the service is right to refuse. Writing the rows
 * here keeps the fixture honest about which bookings are reviewable without weakening the rule.
 *
 * One review is left REPORTED and undecided, so the staff moderation queue has something in it
 * and the partner's «إبلاغ» state is visible on a screen rather than only in a test. Nothing is
 * pre-hidden: a hidden review needs a moderator to have decided, and inventing that decision would
 * put a name against a judgement nobody made.
 */
async function reviews(db: Seeder): Promise<void> {
  const BODIES = [
    'إقامة ممتازة، والاستقبال كان راقياً منذ اللحظة الأولى. الغرفة نظيفة والموقع قريب من كل شيء.',
    'المكان جميل والخدمة جيدة، لكن الإفطار كان محدوداً بعض الشيء.',
    'تجربة رائعة مع العائلة. الأطفال أحبوا المسبح وسنعود بإذن الله.',
    'الصور لا تُنصف المكان — أفضل مما توقعت بكثير.',
    'الموقع ممتاز لكن الضجيج من الشارع كان مزعجاً في الليل.',
    'كل شيء كما وُصف تماماً. شكراً على الاهتمام بالتفاصيل.',
  ];
  const RATINGS = [5, 4, 5, 5, 3, 4];

  /*
    Completed bookings that have no review yet, spread across partners so every fixture partner has
    something on their §7.3 screen. `ON CONFLICT DO NOTHING` on the booking unique index makes a
    re-run a no-op rather than a duplicate-key failure.
  */
  const candidates = await db.execute<{
    id: string;
    property_id: string;
    unit_id: string;
    partner_id: string;
    customer_profile_id: string;
  }>(sql`
    SELECT b.id, b.property_id, b.unit_id, b.partner_id, b.customer_profile_id
    FROM bookings b
    JOIN partners pa   ON pa.id = b.partner_id
    JOIN users u       ON u.id = pa.user_id
    JOIN properties pr ON pr.id = b.property_id
    WHERE b.status = 'completed'
      -- PUBLISHED listings only.
      --
      -- Without this, the round-robin spread reviews evenly across every listing including the
      -- draft and the rejected one — and a trigger owns the rating column, so a listing never
      -- visible to a customer ended up advertising 5.0 stars from eight stays. Fiction on a
      -- fixture is worse than sparse data: it is what a screenshot gets taken of.
      AND pr.status = 'published'
      AND lower(u.email) IN
        ('partner1-legacy@safra.test', 'partner2@safra.test', 'partner3@safra.test')
      AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id)
    -- Spread across PROPERTIES rather than taking the newest eighteen bookings overall.
    --
    -- Ordering by partner alone gave one partner's busiest listing seven reviews and left two
    -- properties with none — which is realistic enough, except that those two then showed no ★ at
    -- all on a screen the §7.2 card exists to exercise. Round-robin by property fixes the
    -- distribution without inventing anything: every review is still a real completed stay.
    --
    -- The FIXTURE CUSTOMER's most recent completed stay is held back, so «إقامات بانتظار تقييمك»
    -- always has exactly one entry. The customer review flow is reachable only from that prompt,
    -- and the spec covering it used to rely on a gap that happened to exist — adding two listings
    -- closed the gap and broke a test with no relationship to the change. A fixture a test needs
    -- has to be arranged on purpose, not left to arithmetic. Named by EMAIL rather than by an
    -- offset, so it stays the right booking however the counts move.
      AND b.id <> coalesce((
        SELECT b2.id
        FROM bookings b2
        JOIN customer_profiles cp2 ON cp2.id = b2.customer_profile_id
        JOIN users cu              ON cu.id = cp2.user_id
        WHERE b2.status = 'completed'
          AND lower(cu.email) = 'customer@safra.test'
        ORDER BY b2.check_out DESC
        LIMIT 1
      ), '00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY row_number() OVER (PARTITION BY b.property_id ORDER BY b.check_out DESC),
             b.property_id
    LIMIT 24
  `);

  let written = 0;

  for (const [index, booking] of candidates.rows.entries()) {
    /*
      A distinguishing tail, so no two seeded reviews share a body.

      Six bodies cycled across twenty-four reviews meant identical text on several, and a probe
      searching the rendered page for a review's words matched a DIFFERENT review — which read as
      "moderation does not remove it from the public page" and cost an hour to disprove. Unique
      text is not realism for its own sake; it is what makes a test that searches for a review
      mean what it says.
    */
    const body = `${BODIES[index % BODIES.length] ?? BODIES[0]} (${index + 1})`;
    const rating = RATINGS[index % RATINGS.length] ?? 5;

    await db.execute(sql`
      INSERT INTO reviews (booking_id, property_id, unit_id, partner_id,
                           customer_profile_id, rating, body)
      VALUES (${booking.id}, ${booking.property_id}, ${booking.unit_id},
              ${booking.partner_id}, ${booking.customer_profile_id}, ${rating}, ${body})
      ON CONFLICT (booking_id) DO NOTHING
    `);

    written += 1;
  }

  // One partner has already answered a guest, and one review is awaiting a staff decision.
  await db.execute(sql`
    UPDATE reviews SET partner_reply = 'شكراً لك على إقامتك معنا، ونتطلع لاستضافتك مجدداً.',
                       partner_replied_at = now()
    WHERE id = (SELECT id FROM reviews WHERE partner_reply IS NULL ORDER BY created_at LIMIT 1)
  `);

  await db.execute(sql`
    UPDATE reviews SET report_status = 'open',
                       report_reason = 'الضيف يصف عقاراً آخر — لم يقم لدينا في هذا التاريخ.',
                       reported_at = now()
    WHERE id = (SELECT id FROM reviews WHERE report_status = 'none' AND rating <= 3
                ORDER BY created_at LIMIT 1)
  `);

  console.log(`  ${written} guest reviews, 1 replied to and 1 reported`);
}

/**
 * One dispute and one three-party thread, on the customer's cancelled booking.
 *
 * The disputes and messages registries are otherwise empty, and an empty section proves nothing
 * about a screen. This is also the pair the console cares most about: النزاعات carries the payout
 * freeze, and الرسائل is the one place customer, partner and SAFRA meet.
 */
async function conversation(db: Seeder, customerProfileId: string): Promise<void> {
  const [booking] = await db
    .select({
      id: schema.bookings.id,
      partnerId: schema.bookings.partnerId,
    })
    .from(schema.bookings)
    .where(eq(schema.bookings.customerProfileId, customerProfileId))
    .limit(1);

  if (!booking) return;

  await db.insert(schema.disputes).values({
    bookingId: booking.id,
    partnerId: booking.partnerId,
    customerProfileId,
    kind: 'not_as_described',
    status: 'open',
    title: 'الغرفة لم تطابق الوصف المنشور',
    description:
      'الوصف يذكر إطلالة على الحديقة، والغرفة تطل على موقف السيارات. طلبت تغيير الغرفة ولم يتوفر بديل.',
  });

  const [thread] = await db
    .insert(schema.conversations)
    /*
      Exactly ONE subject — `conversations_exactly_one_subject_v2` enforces it. A thread attached to
      both a booking and a partner would appear in two inboxes with two different sets of
      participants, so the booking is the subject and the dispute is reached through it.
    */
    .values({
      bookingId: booking.id,
      customerProfileId,
      lastMessageAt: new Date(),
    })
    .returning();

  if (!thread) return;

  const lines = [
    {
      senderKind: 'customer' as const,
      body: 'مساء الخير، الغرفة لا تطابق الصور المنشورة.',
    },
    {
      senderKind: 'partner' as const,
      body: 'نعتذر عن ذلك. سنتحقق من الصور ونعرض عليك غرفة بديلة إن توفرت.',
    },
    {
      senderKind: 'staff' as const,
      body: 'فُتح نزاع بهذا الخصوص. مستحقات الشريك مجمّدة حتى إغلاقه.',
    },
  ];

  for (const line of lines) {
    await db.insert(schema.messages).values({ conversationId: thread.id, ...line });
  }

  console.log('  1 dispute and a three-party thread');
}

async function report(db: Seeder): Promise<void> {
  const rows = await db.execute<{ label: string; n: number }>(sql`
    SELECT 'partners' AS label, count(*)::int AS n FROM partners
    UNION ALL SELECT 'properties', count(*)::int FROM properties
    UNION ALL SELECT 'units', count(*)::int FROM units
    UNION ALL SELECT 'customers', count(*)::int FROM customer_profiles
    UNION ALL SELECT 'bookings', count(*)::int FROM bookings
    UNION ALL SELECT 'users', count(*)::int FROM users`);

  console.log('\nTestbed ready.\n');
  for (const row of rows.rows)
    console.log(`  ${String(row.n).padStart(4)}  ${row.label}`);

  console.log('\n  Sign in with:');
  for (const partner of PARTNERS) {
    const second = partner.twoFactorEnrolled
      ? 'authenticator enrolled'
      : 'code by email at every sign-in';

    console.log(
      `    ${partner.email.padEnd(24)} ${partner.displayName.padEnd(18)} ${second}`,
    );
  }
  console.log(`    ${CUSTOMER.email.padEnd(24)} ${CUSTOMER.fullName}`);
  console.log(
    `    ${APPLICANT.email.padEnd(24)} customer — never a partner, for the join journey`,
  );
  console.log(`\n  Password for all of them: ${PASSWORD}`);
  console.log('  (override with TESTBED_PASSWORD)');
  /*
    No authenticator secret is printed any more: no fixture partner has one. The sign-in code is
    emailed, so the way to read it is the mail catcher rather than a generator.
  */
  console.log(
    '\n  Partner sign-in codes arrive by email — read them at http://localhost:8025\n',
  );

  await selfCheck(db);
}

/**
 * What the seed CLAIMS, checked against what it wrote.
 *
 * ## Why this exists
 *
 * Three times a fixture has published something the product could never produce, and every one was
 * found by an unrelated test failing rather than by anybody looking:
 *
 * - A listing declared `rating: 4.9, reviewsCount: 118` as literals while a trigger owned both
 *   columns, so it advertised a score with no reviews behind it.
 * - A DRAFT listing accumulated ninety days of completed stays and eight reviews, and the trigger
 *   gave it five stars — on a listing no customer had ever been able to book.
 * - A browser test depended on an un-reviewed stay that existed only by arithmetic; adding two
 *   listings closed the gap and broke a spec with no relationship to the change.
 *
 * Each was cheap to fix and expensive to find. These assertions run at SEED time, where the cause
 * and the symptom are still in the same place.
 *
 * ## Why it throws rather than warns
 *
 * A warning printed after two hundred lines of seed output is a warning nobody reads. A seed that
 * refuses to finish is one somebody fixes, and the only thing lost is a testbed that was already
 * lying.
 */
async function selfCheck(db: Seeder): Promise<void> {
  const problems: string[] = [];

  /*
    Scoped to the seed's OWN listings.

    Integration-test debris lives in the same database and follows a `*-test-*` slug; flagging it
    here would make the seed refuse to finish over rows it did not write and cannot fix, which
    turns a useful check into one somebody disables. `O-data-2` is where that debris is dealt with.
  */
  const unpublishedWithRating = await db.execute<{ slug: string; rating: string }>(sql`
    SELECT slug, rating::text AS rating
    FROM properties
    WHERE status <> 'published' AND deleted_at IS NULL
      AND slug NOT LIKE '%-test-%'
      AND (rating IS NOT NULL OR reviews_count > 0)
  `);

  for (const row of unpublishedWithRating.rows) {
    problems.push(
      `${row.slug} is not published but carries a rating of ${row.rating} — a listing no customer could book cannot have been reviewed`,
    );
  }

  const unpublishedWithBookings = await db.execute<{ slug: string; n: string }>(sql`
    SELECT p.slug, count(*)::text AS n
    FROM bookings b
    JOIN properties p ON p.id = b.property_id
    WHERE p.status <> 'published' AND p.deleted_at IS NULL
      AND p.slug NOT LIKE '%-test-%'
    GROUP BY p.slug
  `);

  for (const row of unpublishedWithBookings.rows) {
    problems.push(`${row.slug} is not published but has ${row.n} bookings against it`);
  }

  /* The fixture `e2e/customer-review.spec.ts` needs: exactly one stay waiting to be reviewed. */
  const pending = await db.execute<{ n: string }>(sql`
    SELECT count(*)::text AS n
    FROM bookings b
    JOIN customer_profiles cp ON cp.id = b.customer_profile_id
    JOIN users u              ON u.id = cp.user_id
    WHERE b.status = 'completed'
      AND lower(u.email) = ${CUSTOMER.email.toLowerCase()}
      AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id)
  `);

  if (Number(pending.rows[0]?.n ?? 0) < 1) {
    problems.push(
      'the fixture customer has no un-reviewed completed stay, so «إقامات بانتظار تقييمك» is empty and the customer review flow is unreachable',
    );
  }

  /* Every slug a browser spec names by hand. A rename here breaks a spec three files away. */
  const NAMED_BY_SPECS = [
    'qasr-al-sharq-malki',
    'qasr-al-sharq-apartments',
    'qasr-al-sharq-lodge',
    'qasr-al-sharq-rest-house',
    'coastal-resort',
  ];

  /*
    Read the slugs and compare in TypeScript rather than passing an array to `ANY`: drizzle expands
    a JS array into a positional TUPLE, which is a syntax error against `ANY`. Five string
    comparisons in memory is not worth a cast that hides that.
  */
  const found = await db.execute<{ slug: string }>(sql`
    SELECT slug FROM properties WHERE deleted_at IS NULL
  `);

  const present = new Set(found.rows.map((row) => row.slug));

  for (const slug of NAMED_BY_SPECS) {
    if (!present.has(slug))
      problems.push(`${slug} is named by a browser spec and was not seeded`);
  }

  /* A published listing with no unit cannot be booked, so it is not a usable fixture either. */
  const unbookable = await db.execute<{ slug: string }>(sql`
    SELECT p.slug FROM properties p
    WHERE p.status = 'published' AND p.deleted_at IS NULL
      AND p.slug NOT LIKE '%-test-%'
      AND NOT EXISTS (
        SELECT 1 FROM units un WHERE un.property_id = p.id AND un.deleted_at IS NULL
      )
  `);

  for (const row of unbookable.rows) {
    problems.push(
      `${row.slug} is published with no unit, so nothing on it can be booked`,
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `The testbed finished but describes something impossible:\n  - ${problems.join('\n  - ')}`,
    );
  }

  console.log(
    `  self-check passed: ${NAMED_BY_SPECS.length} named fixtures present, no listing claims what it cannot have`,
  );
}

main().catch((error: unknown) => {
  /*
    `describeError` here too, for consistency rather than for secrecy: this prints to a developer's
    terminal against a development database. It costs nothing and it stops this line being the
    pattern somebody copies into a service, which is how the twenty other instances happened.
  */
  console.error(describeError(error));
  process.exit(1);
});
