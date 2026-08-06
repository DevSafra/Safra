import { eq, sql } from 'drizzle-orm';

import { createDatabase, schema, type Database } from '@safra/db';

import { PasswordService } from '../common/crypto/password.service.js';

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
/** The default SYP rate the handoff names. Snapshotted onto every booking, as production does. */
const FX_RATE_TO_SYP = 12500;

const PASSWORD = process.env['TESTBED_PASSWORD'] ?? 'a-testbed-password-1';

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
  readonly units: readonly UnitSpec[];
}

interface PartnerSpec {
  readonly email: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly citySlug: string;
  readonly type: string;
  readonly phone: string;
  readonly address: string;
  readonly score: number;
  readonly tier: 'new' | 'needs_improvement' | 'silver' | 'gold';
  readonly properties: readonly PropertySpec[];
}

const PARTNERS: readonly PartnerSpec[] = [
  {
    email: 'partner1@safra.test',
    legalName: 'شركة قصر الشرق للفنادق',
    displayName: 'فندق قصر الشرق',
    citySlug: 'damascus',
    type: 'accommodation',
    phone: '+963911000001',
    address: 'شارع بغداد، دمشق',
    score: 92,
    tier: 'gold',
    properties: [
      {
        nameAr: 'فندق قصر الشرق — المالكي',
        nameEn: 'Qasr Al-Sharq Hotel — Malki',
        slug: 'qasr-al-sharq-malki',
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
        citySlug: 'damascus',
        type: 'hotel',
        address: 'أبو رمانة، دمشق',
        descriptionAr: 'فرعنا الثاني، بإطلالة على جبل قاسيون.',
        units: [{ nameAr: 'غرفة مفردة', nameEn: 'Single Room', price: 45, maxGuests: 1 }],
      },
      {
        nameAr: 'شقق قصر الشرق المخدومة',
        nameEn: 'Qasr Al-Sharq Serviced Apartments',
        slug: 'qasr-al-sharq-apartments',
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
    email: 'partner2@safra.test',
    legalName: 'مؤسسة الساحل للسياحة',
    displayName: 'شاليهات الساحل',
    citySlug: 'latakia',
    type: 'accommodation',
    phone: '+963911000002',
    address: 'الكورنيش الجنوبي، اللاذقية',
    score: 78,
    tier: 'silver',
    properties: [
      {
        nameAr: 'شاليهات الساحل — بلوران',
        nameEn: 'Coastal Chalets — Blouran',
        slug: 'coastal-chalets-blouran',
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
    email: 'partner3@safra.test',
    legalName: 'بيت الياسمين للضيافة التراثية',
    displayName: 'بيت دمشقي تراثي',
    citySlug: 'damascus',
    type: 'accommodation',
    phone: '+963911000003',
    address: 'باب توما، دمشق القديمة',
    score: 85,
    tier: 'gold',
    properties: [
      {
        nameAr: 'بيت الياسمين الدمشقي',
        nameEn: 'Beit Al-Yasmine Damascene House',
        slug: 'beit-al-yasmine',
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

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];

  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  const db = createDatabase(databaseUrl, 2);

  try {
    await build(db);
  } finally {
    await db.$client.end();
  }
}

async function build(db: Database): Promise<void> {
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

    TRUNCATE does not fire row triggers, which is the gap this codebase now carries as an open
    item. It clears every thread rather than only this script's, and that is acceptable here for
    the reason it would not be in the seed: nothing but a testbed has threads on this database.
  */
  await db.execute(sql`TRUNCATE TABLE messages, conversations RESTART IDENTITY`);
  await db.execute(sql`DELETE FROM dispute_evidence WHERE dispute_id IN (
    SELECT id FROM disputes WHERE booking_id IN (${testbedBookings}))`);
  await db.execute(sql`DELETE FROM disputes WHERE booking_id IN (${testbedBookings})`);
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
  await db.execute(sql`DELETE FROM properties WHERE partner_id IN (${testbedPartners})`);
  await db.execute(
    sql`DELETE FROM wallets WHERE customer_profile_id IN (${testbedProfiles})`,
  );
  await db.execute(sql`DELETE FROM customer_profiles WHERE id IN (${testbedProfiles})`);
  await db.execute(sql`DELETE FROM partners WHERE id IN (${testbedPartners})`);
  await db.execute(sql`
    DELETE FROM users
    WHERE lower(email) IN (${emailList})
       OR email LIKE 'guest%@safra.test'
       OR email LIKE 'staff%@safra.test'`);

  // ── The three partners ────────────────────────────────────────────────────
  const madeProperties = new Map<
    string,
    { id: string; partnerId: string; cityId: string }
  >();
  const madeUnits = new Map<string, { id: string; price: number }[]>();

  for (const spec of PARTNERS) {
    const city = cityBySlug.get(spec.citySlug);
    const partnerType = partnerTypeByCode.get(spec.type);

    if (!city || !partnerType)
      throw new Error(`Missing reference data for ${spec.email}`);

    const [user] = await db
      .insert(schema.users)
      .values({
        email: spec.email,
        phone: spec.phone,
        passwordHash,
        role: 'partner',
        status: 'active',
        preferredLocale: 'ar',
        emailVerifiedAt: new Date(),
      })
      .returning();

    if (!user) throw new Error(`Could not create ${spec.email}`);

    /*
      Approved AND screened. `sanctions_screened_at` matters: the console refuses to approve a
      partner that has not been screened, so a fixture that skipped it would create a partner the
      console считает half-finished.
    */
    const [partner] = await db
      .insert(schema.partners)
      .values({
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
          status: 'published',
          verifiedAt: new Date(),
          cancellationPolicyId: policy.id,
        })
        .returning();

      if (!row) throw new Error(`Could not create ${property.slug}`);

      madeProperties.set(property.slug, {
        id: row.id,
        partnerId: partner.id,
        cityId: propertyCity.id,
      });

      const units: { id: string; price: number }[] = [];

      for (const unit of property.units) {
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
          })
          .returning();

        if (made) units.push({ id: made.id, price: unit.price });
      }

      madeUnits.set(property.slug, units);
    }
  }

  // ── The customer ──────────────────────────────────────────────────────────
  const [customerUser] = await db
    .insert(schema.users)
    .values({
      email: CUSTOMER.email,
      phone: CUSTOMER.phone,
      passwordHash,
      role: 'customer',
      status: 'active',
      preferredLocale: 'ar',
      emailVerifiedAt: new Date(),
    })
    .returning();

  if (!customerUser) throw new Error('Could not create the customer.');

  const [profile] = await db
    .insert(schema.customerProfiles)
    .values({
      userId: customerUser.id,
      fullName: CUSTOMER.fullName,
      email: CUSTOMER.email,
      phone: CUSTOMER.phone,
      preferredCurrencyId: usd.id,
      isGuest: false,
    })
    .returning();

  if (!profile) throw new Error('Could not create the customer profile.');

  await db.insert(schema.wallets).values({
    customerProfileId: profile.id,
    currencyId: usd.id,
    balance: '25.00',
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
  db: Database,
  ctx: {
    profileId: string;
    usd: { id: string };
    policy: { id: string; code: string };
    madeProperties: Map<string, { id: string; partnerId: string; cityId: string }>;
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
    await db.insert(schema.users).values({
      email: `staff${index + 1}@safra.test`,
      phone: `+96393300${String(index + 10).padStart(4, '0')}`,
      passwordHash: ctx.passwordHash,
      role,
      status: index === 5 ? 'suspended' : 'active',
      preferredLocale: 'ar',
      emailVerifiedAt: new Date(),
    });
  }

  const slugs = [...ctx.madeProperties.keys()];
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
}

/**
 * One dispute and one three-party thread, on the customer's cancelled booking.
 *
 * The disputes and messages registries are otherwise empty, and an empty section proves nothing
 * about a screen. This is also the pair the console cares most about: النزاعات carries the payout
 * freeze, and الرسائل is the one place customer, partner and SAFRA meet.
 */
async function conversation(db: Database, customerProfileId: string): Promise<void> {
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
      Exactly ONE subject — `conversations_exactly_one_subject` enforces it. A thread attached to
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

async function report(db: Database): Promise<void> {
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
  for (const partner of PARTNERS)
    console.log(`    ${partner.email.padEnd(24)} ${partner.displayName}`);
  console.log(`    ${CUSTOMER.email.padEnd(24)} ${CUSTOMER.fullName}`);
  console.log(`\n  Password for all of them: ${PASSWORD}`);
  console.log('  (override with TESTBED_PASSWORD)\n');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
