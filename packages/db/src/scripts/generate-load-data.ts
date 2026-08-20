/**
 * Production-shaped data for the load test (`docs/load-testing.md` §Data).
 *
 * ## Why this exists, and why it existed as a sentence before it existed as code
 *
 * The plan said: "A generator does not exist. Writing one is unblocked engineering work (~1 day) and
 * it should be written before the hosting decision, not after, so the day infrastructure exists the
 * test runs rather than starts." This is that generator.
 *
 * The single most misleading measurement available to this project is a fast query over 200 rows.
 * The dev database holds 2,703 properties and THIRTEEN availability days; every search plan measured
 * against it is a plan over a table small enough to sit in cache, which is not the plan production
 * will run. So the volumes below come from the document, not from what is convenient.
 *
 * ## It refuses to touch anything but a load database
 *
 * `assertLoadDatabase` is the first thing that runs. Generating seventy million rows into the
 * development database would destroy the fixtures the browser suite depends on and be tedious to
 * undo — and the mistake is one character in a URL. The guard is a name allow-list, not a warning.
 *
 * ## Everything is generated server-side
 *
 * Every insert is `INSERT … SELECT … FROM generate_series`. Round-tripping a hundred million rows
 * through Node would take a day and measure the driver. `availability_days` is additionally chunked
 * by unit, because one statement producing seventy million rows holds one transaction and one WAL
 * write for its whole duration.
 *
 * ## Constraints are kept, not dropped
 *
 * Bulk loaders usually drop indexes and constraints and rebuild them afterwards. Not here: the
 * exclusion constraint over `daterange` and the deferred ledger-balance trigger are part of the
 * shape being measured, and a database loaded without them is not the database that runs. So the
 * generated data is made to SATISFY them — bookings get non-overlapping stays per unit, ledger legs
 * are emitted in balanced groups of four.
 *
 * Usage:
 *   LOAD_DATABASE_URL=… LOAD_SCALE=0.01 pnpm load:generate
 *
 * `LOAD_SCALE` is a fraction of the documented volumes. 1 is the full set; 0.01 is a smoke test that
 * still exercises every code path in this file.
 */
import { Pool } from 'pg';

/** The volumes from `docs/load-testing.md`, at scale 1. */
const FULL = {
  users: 1_000_000,
  properties: 50_000,
  units: 200_000,
  bookings: 5_000_000,
  availabilityDays: 70_000_000,
  auditLog: 20_000_000,
  ledgerEntries: 20_000_000,
} as const;

/** Units per statement when filling `availability_days`. */
const UNIT_CHUNK = 2_000;

/** Ledger entries are emitted in balanced groups of this many legs. */
const LEDGER_LEGS_PER_GROUP = 4;

/** Balanced groups per transaction — see the deferred-trigger note where this is used. */
const LEDGER_GROUP_CHUNK = 25_000;

/**
 * Days of availability per unit.
 *
 * Held at 365 rather than scaled: a unit with four days of calendar is not a smaller version of a
 * real unit, it is a different shape, and the date-range scan being measured depends on the span.
 * Scale reduces the NUMBER of units instead.
 */
const DAYS_PER_UNIT = 365;

type Counts = Record<keyof typeof FULL, number>;

function countsFor(scale: number): Counts {
  const scaled = Object.fromEntries(
    Object.entries(FULL).map(([key, value]) => [
      key,
      Math.max(1, Math.round(value * scale)),
    ]),
  ) as Counts;

  /*
    `availability_days` is derived, never scaled independently: it is units × days by definition, and
    a figure that disagreed with that would describe a calendar with holes in it.
  */
  scaled.availabilityDays = scaled.units * DAYS_PER_UNIT;

  return scaled;
}

/**
 * Refuses any database whose name does not announce itself as a load target.
 *
 * An allow-list on the NAME, because the failure it prevents is a URL typed with the wrong suffix,
 * and every other check — row counts, emptiness, a confirmation prompt — either passes on the dev
 * database or can be answered by reflex.
 */
function assertLoadDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');

  if (!/(^|_)load(_|$)/.test(name)) {
    throw new Error(
      `Refusing to generate into "${name}". This script writes tens of millions of rows and is ` +
        'only ever pointed at a database whose name contains "load" — e.g. safra_load. Create one ' +
        'with CREATE DATABASE safra_load, migrate it, seed the reference data, and try again.',
    );
  }
}

/**
 * Refuses a database that already holds generated data.
 *
 * ## Why it insists rather than cleaning up
 *
 * `audit_log`, `ledger_entries` and their siblings carry `deny_mutation` triggers: they are
 * append-only, so TRUNCATE and DELETE are both REFUSED — correctly, since they are evidence. That
 * makes a re-run impossible to tidy after, and it makes "insert on top" wrong in a subtler way: a
 * second pass would collide on `users_email_unique` and, if it did not, would leave a database whose
 * volumes nobody can state.
 *
 * So the contract is a fresh database, and the message says exactly how to get one. This is not a
 * limitation being worked around; a load test whose starting state is unknown measures nothing.
 */
async function assertEmpty(pool: Pool): Promise<void> {
  const used = await pool.query<{ table_name: string; n: string }>(
    `SELECT t AS table_name, n::text FROM (
       SELECT 'users' t, count(*) n FROM users WHERE email LIKE 'load-%'
       UNION ALL SELECT 'partner_applications', count(*) FROM partner_applications
       UNION ALL SELECT 'availability_days', count(*) FROM availability_days
       UNION ALL SELECT 'bookings', count(*) FROM bookings
       UNION ALL SELECT 'audit_log', count(*) FROM audit_log
       UNION ALL SELECT 'ledger_entries', count(*) FROM ledger_entries
     ) counted WHERE n > 0`,
  );

  if (used.rows.length === 0) return;

  const found = used.rows.map((row) => `${row.table_name}=${row.n}`).join(', ');

  throw new Error(
    `This database already holds data (${found}).\n\n` +
      'The append-only tables cannot be emptied — TRUNCATE and DELETE are refused by trigger — so ' +
      'a re-run needs a fresh database:\n\n' +
      '  pnpm load:reset      # drops and recreates it\n' +
      '  DATABASE_URL=$LOAD_DATABASE_URL pnpm db:migrate\n' +
      '  DATABASE_URL=$LOAD_DATABASE_URL pnpm db:seed\n' +
      '  pnpm load:generate\n',
  );
}

async function main(): Promise<void> {
  const url = process.env['LOAD_DATABASE_URL'];

  if (!url) throw new Error('LOAD_DATABASE_URL is required.');

  assertLoadDatabase(url);

  const scale = Number(process.env['LOAD_SCALE'] ?? '0.01');

  if (!Number.isFinite(scale) || scale <= 0 || scale > 1) {
    throw new Error('LOAD_SCALE must be a fraction in (0, 1].');
  }

  const counts = countsFor(scale);
  const pool = new Pool({ connectionString: url, max: 4 });
  const started = Date.now();

  const step = async (label: string, run: () => Promise<void>): Promise<void> => {
    const at = Date.now();
    process.stdout.write(`${label} … `);
    await run();
    console.log(`${((Date.now() - at) / 1000).toFixed(1)}s`);
  };

  const exec = async (sql: string, params: unknown[] = []): Promise<void> => {
    await pool.query(sql, params);
  };

  console.log(
    `Generating at scale ${scale} into ${new URL(url).pathname.slice(1)}:\n` +
      Object.entries(counts)
        .map(([key, value]) => `  ${key.padEnd(18)} ${value.toLocaleString('en')}`)
        .join('\n') +
      '\n',
  );

  try {
    /*
      Reference data must already exist — this generator deliberately does not create cities or
      currencies, because those are `db:seed`'s job and a second definition of them would drift.
    */
    const reference = await pool.query<{
      cities: string;
      currencies: string;
      types: string;
    }>(
      `SELECT (SELECT count(*)::text FROM cities)            AS cities,
              (SELECT count(*)::text FROM currencies)        AS currencies,
              (SELECT count(*)::text FROM property_types)    AS types`,
    );

    const ref = reference.rows[0];

    if (!ref || ref.cities === '0' || ref.currencies === '0' || ref.types === '0') {
      throw new Error(
        'Reference data is missing. Run db:migrate and db:seed against this database first.',
      );
    }

    await assertEmpty(pool);

    await step('users', () =>
      exec(
        `INSERT INTO users (email, phone, role, status, preferred_locale)
         SELECT 'load-' || n || '@safra.test',
                '+9639' || lpad((n % 100000000)::text, 8, '0'),
                'customer'::user_role, 'active'::user_status,
                (ARRAY['ar','en','de'])[1 + (n % 3)]
         FROM generate_series(1, $1) AS n`,
        [counts.users],
      ),
    );

    /*
      One profile per user, so the booking generator can pick an owner without a join that skews.
      `is_guest = false`: a guest profile has no user, and these all do.
    */
    await step('customer_profiles', () =>
      exec(
        `INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest, preferred_locale,
                                        gender)
         SELECT u.id, 'Load Customer ' || u.email, u.email, u.phone, false, u.preferred_locale,
                -- Spread rather than left on the column default.
                --
                -- \`gender\` arrived with migration 0030 defaulting to 'undisclosed' NOT NULL, so a
                -- generator that ignores it produces a million rows with one value. Nothing filters
                -- on it on a request path today, which is exactly why it would go unnoticed until
                -- something did — a report grouped by a constant column reads as a working report
                -- over a population that does not exist.
                --
                -- The spread is taken from the email's own counter rather than from
                -- \`preferred_locale\`, which already encodes n % 3: reusing it would make gender and
                -- locale perfectly correlated, and a correlated pair in generated data is worse than
                -- a constant one because it looks like a finding.
                (ARRAY['male','female','undisclosed']::gender[])[
                  1 + (split_part(split_part(u.email, '-', 2), '@', 1)::bigint % 3)
                ]
         FROM users u
         WHERE u.email LIKE 'load-%@safra.test'`,
      ),
    );

    /*
      One partner per ten properties — the real ratio is a long tail, and a partner per property
      would make every "this partner's listings" query return one row, which is the wrong shape for
      the console's registries.
    */
    const partnerCount = Math.max(1, Math.round(counts.properties / 10));

    await step('partners', () =>
      exec(
        `INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                               address, phone, email, verification, score)
         SELECT u.id, pt.id, 'Load Partner ' || n, 'شريك ' || n, ci.id,
                'Load address ' || n, '+96311' || lpad(n::text, 7, '0'),
                'load-partner-' || n || '@safra.test',
                'approved'::verification_status, 50 + (n % 50)
         FROM generate_series(1, $1) AS n
         CROSS JOIN LATERAL (
           SELECT id FROM users WHERE email = 'load-' || n || '@safra.test'
         ) u
         CROSS JOIN LATERAL (
           SELECT id FROM partner_types ORDER BY (n % 4) LIMIT 1
         ) pt
         CROSS JOIN LATERAL (
           -- Spread across the cities by OFFSET, not by an ORDER BY expression.
           --
           -- This was ORDER BY (id::text || n::text) LIMIT 1, which reads as "vary the order per
           -- partner" and is not: the sort is over one candidate set and the winner came out the
           -- same every time, so all 50,000 properties landed in ONE city. It looked plausible and
           -- silently destroyed the only realistic city filter — a search for the loaded city was
           -- an unfiltered search, and a search for any other returned nothing in 855 ms, which
           -- reads as "the filter is fast" rather than "there is nothing there".
           SELECT id FROM cities WHERE deleted_at IS NULL
           ORDER BY slug
           OFFSET (n % (SELECT count(*) FROM cities WHERE deleted_at IS NULL))
           LIMIT 1
         ) ci`,
        [partnerCount],
      ),
    );

    /*
      Partner applications — «طلبات الشراكة», the registry that shipped with O-partner-6.

      It is not in the plan's volume table because it did not exist when the table was written, and a
      registry with no rows cannot be measured: scenario 3 would page an empty list and report that
      paging is free. Three per partner is the shape the flow implies — every partner arrived through
      an accepted application, and the rejected and still-open ones stay in the table forever.

      Deliberately ABOVE `COUNT_CAP` (10,000) at full scale, because the capped count is a code path:
      past the cap the bar must print «أكثر من ١٠٠٠٠ نتيجة» rather than a figure, and a table that
      never crosses it never exercises that.

      `created_at` is spread explicitly. `now()` is the TRANSACTION timestamp (§8, "rows written in
      one test all tie"), so without this every row would carry one instant and
      `ORDER BY created_at DESC, reference DESC` would be decided entirely by the tiebreaker — a sort
      over a constant column, which is not the sort the console runs.
    */
    const applicationCount = partnerCount * 3;

    await step('partner_applications', () =>
      exec(
        `INSERT INTO partner_applications (status, submitted_by_user_id, contact_name, email, phone,
                                           legal_name, display_name, partner_type_id, city_id,
                                           address, property_count, website, message,
                                           preferred_locale, contacted_at, contacted_by_user_id,
                                           contact_notes, decided_at, decided_by_user_id,
                                           decision_notes, partner_id, created_at)
         SELECT st.status,
                u.id,
                'Load Applicant ' || n,
                'load-app-' || n || '@safra.test',
                '+96312' || lpad(n::text, 7, '0'),
                'Load Applicant Legal ' || n, 'مقدم طلب ' || n,
                pt.id, ci.id,
                'Load applicant address ' || n,
                CASE WHEN n % 5 = 0 THEN NULL ELSE 1 + (n % 12) END,
                CASE WHEN n % 3 = 0 THEN 'https://load-' || n || '.example' ELSE NULL END,
                CASE WHEN n % 7 = 0 THEN NULL ELSE 'Load application message ' || n END,
                (ARRAY['ar','en','de'])[1 + (n % 3)],
                CASE WHEN st.status <> 'submitted'
                     THEN now() - ((n % 700) || ' days')::interval + interval '2 days' END,
                CASE WHEN st.status <> 'submitted' THEN u.id END,
                CASE WHEN st.status <> 'submitted' THEN 'Load call note ' || n END,
                CASE WHEN st.status IN ('accepted','rejected')
                     THEN now() - ((n % 700) || ' days')::interval + interval '3 days' END,
                CASE WHEN st.status IN ('accepted','rejected') THEN u.id END,
                CASE WHEN st.status IN ('accepted','rejected') THEN 'Load decision note ' || n END,
                -- Only an accepted application owns a partner row. The others must be NULL: an
                -- application that was rejected and still points at a partner is a state the
                -- console renders and the flow cannot produce.
                CASE WHEN st.status = 'accepted' THEN pa.id END,
                now() - ((n % 700) || ' days')::interval
         FROM generate_series(1, $1) AS n
         CROSS JOIN LATERAL (
           SELECT (CASE
                     WHEN n % 10 IN (0, 1) THEN 'submitted'
                     WHEN n % 10 = 2       THEN 'contacted'
                     WHEN n % 10 = 9       THEN 'rejected'
                     ELSE 'accepted'
                   END)::partner_application_status AS status
         ) st
         CROSS JOIN LATERAL (
           SELECT id FROM users WHERE email LIKE 'load-%@safra.test' ORDER BY id
           OFFSET (n % 500) LIMIT 1
         ) u
         CROSS JOIN LATERAL (SELECT id FROM partner_types ORDER BY (n % 4) LIMIT 1) pt
         CROSS JOIN LATERAL (
           SELECT id FROM cities WHERE deleted_at IS NULL ORDER BY slug
           OFFSET (n % (SELECT count(*) FROM cities WHERE deleted_at IS NULL)) LIMIT 1
         ) ci
         CROSS JOIN LATERAL (
           SELECT id FROM partners WHERE email LIKE 'load-partner-%' ORDER BY id
           OFFSET (n % $2) LIMIT 1
         ) pa`,
        [applicationCount, partnerCount],
      ),
    );

    await step('properties', () =>
      exec(
        `INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                 slug, name_ar, name_en, name_de, address, room_number, status,
                                 rating, reviews_count, recommendation_score, attributes, badges)
         SELECT pa.id, pa.city_id, pt.id, cp.id,
                'load-property-' || n,
                'عقار ' || n, 'Property ' || n, 'Unterkunft ' || n,
                'Load street ' || n,
                -- Nullable, and MOSTLY null on purpose: a room number is a hotel-shaped
                -- property's detail and an apartment has none. A column that is null in
                -- every row and a column that is set in every row are both unrealistic, and
                -- the second is the one that hides a missing null check.
                CASE WHEN n % 4 = 0 THEN 'A-' || (100 + (n % 900)) ELSE NULL END,
                'published'::property_status,
                -- A spread of ratings, so ORDER BY rating is not a constant.
                round((3 + (n % 21) / 10.0)::numeric, 1),
                n % 400,
                round((5 + (n % 50) / 10.0)::numeric, 3),
                (ARRAY['family_friendly','sea_view','quiet'])[1 + (n % 3):3],
                CASE WHEN n % 17 = 0 THEN ARRAY['top_rated'] ELSE ARRAY[]::text[] END
         FROM generate_series(1, $1) AS n
         CROSS JOIN LATERAL (
           SELECT id, city_id FROM partners
           WHERE email LIKE 'load-partner-%'
           ORDER BY id OFFSET (n % $2) LIMIT 1
         ) pa
         CROSS JOIN LATERAL (SELECT id FROM property_types ORDER BY (n % 5) LIMIT 1) pt
         CROSS JOIN LATERAL (SELECT id FROM cancellation_policies ORDER BY (n % 3) LIMIT 1) cp`,
        [counts.properties, partnerCount],
      ),
    );

    const unitsPerProperty = Math.max(1, Math.round(counts.units / counts.properties));

    await step('units', () =>
      exec(
        `INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, bedrooms, beds,
                            bathrooms, base_price, currency_id, min_nights, is_active)
         SELECT p.id, 'وحدة ' || k, 'Unit ' || k, 'Einheit ' || k,
                2 + (k % 6), 1 + (k % 3), 1 + (k % 4), 1 + (k % 2),
                round((40 + (k % 200))::numeric, 2), cur.id, 1 + (k % 3), true
         FROM properties p
         CROSS JOIN generate_series(1, $1) AS k
         CROSS JOIN LATERAL (SELECT id FROM currencies WHERE code = 'USD' LIMIT 1) cur
         WHERE p.slug LIKE 'load-property-%'`,
        [unitsPerProperty],
      ),
    );

    /*
      The largest table by far, and the plan calls it the one to watch. Chunked by unit so no single
      statement holds a transaction over seventy million rows.
    */
    await step(
      `availability_days (${counts.availabilityDays.toLocaleString('en')})`,
      async () => {
        const ids = await pool.query<{ id: string }>(
          `SELECT u.id FROM units u
         JOIN properties p ON p.id = u.property_id
         WHERE p.slug LIKE 'load-property-%'
         ORDER BY u.id`,
        );

        const unitIds = ids.rows.map((row) => row.id);

        for (let at = 0; at < unitIds.length; at += UNIT_CHUNK) {
          const chunk = unitIds.slice(at, at + UNIT_CHUNK);

          await exec(
            `INSERT INTO availability_days (unit_id, date, status, price, min_nights)
           SELECT u, current_date + d,
                  -- 'closed' is the partner-set state; 'booked' is only ever written by a booking,
                  -- so a generator must not fabricate it (see partner-screens.spec.ts).
                  CASE WHEN (d % 23) = 0 THEN 'closed'::day_status ELSE 'available'::day_status END,
                  CASE WHEN (d % 7) IN (5, 6) THEN round((60 + (d % 90))::numeric, 2) ELSE NULL END,
                  NULL
           FROM unnest($1::uuid[]) AS u
           CROSS JOIN generate_series(0, $2 - 1) AS d
           ON CONFLICT (unit_id, date) DO NOTHING`,
            [chunk, DAYS_PER_UNIT],
          );

          const done = Math.min(at + UNIT_CHUNK, unitIds.length);
          process.stdout.write(`\r  availability_days: ${done}/${unitIds.length} units `);
        }

        process.stdout.write('\r');
      },
    );

    /*
      Bookings, with NON-OVERLAPPING stays per unit.

      `bookings_no_overlapping_stays_v2` is a gist exclusion constraint over (unit_id, daterange) for
      live statuses. Random dates would collide constantly and abort the load — and dropping the
      constraint would remove the thing scenario 2 exists to test. So each unit's bookings are laid
      out on a deterministic ladder: stay `i` starts at `i * SPACING`, two nights long.
    */
    await step('bookings', async () => {
      const perUnit = Math.max(1, Math.ceil(counts.bookings / counts.units));
      const spacing = Math.max(3, Math.floor(DAYS_PER_UNIT / perUnit));

      /*
        One statement per rung of the ladder, so each transaction inserts `units` rows rather than
        `units × perUnit`. The gist exclusion constraint is checked per row against the index, and a
        single five-million-row transaction holds every one of those checks open at once.
      */

      /*
        ## `created_at` is spread WITHIN the rung, and that is not cosmetic

        `now()` is the TRANSACTION timestamp, so one statement per rung meant one `created_at` per
        rung: 5,000,061 bookings across 86 distinct values, and all 200,000 `confirmed` rows sharing
        exactly ONE. It is the trap `docs/FUTURE-WORK.md` §8 already records — "rows written in one
        test all tie" — walked into by the generator itself.

        What it cost, found on 2026-08-20: the console's default order is
        `created_at DESC, id DESC`, so every measurement of it was a sort over a column that barely
        varied, decided entirely by the tiebreaker. `?status=confirmed` page 1 read 236,526 buffers
        not because the plan was bad but because 200,000 rows tied on the sort key and the top 25 of
        that tie had to be found by sorting all of them. A plan measured over that data says nothing
        about the plan over real data, which is the one thing a load database exists to avoid.

        The offset is derived from the unit id rather than from `random()`, so a regenerated database
        is comparable with the one before it.
      */
      for (let rung = 0; rung < perUnit; rung += 1) {
        await exec(
          `INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                                 check_in, check_out, guests_adults, status,
                                 base_amount, customer_fee_value, customer_fee_amount,
                                 partner_commission_rate, partner_commission_amount,
                                 total_amount, partner_payable_amount, currency_id,
                                 fx_rate_to_syp, total_syp, cancellation_policy_snapshot,
                                 paid_at, created_at)
           SELECT cp.id, u.id, p.id, p.partner_id, p.city_id,
                  current_date - $2::int + ($1::int * $3::int),
                  current_date - $2::int + ($1::int * $3::int) + 2,
                  2,
                  (CASE WHEN $1::int = 0 THEN 'confirmed' ELSE 'completed' END)::booking_status,
                  '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
                  cur.id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb,
                  now() - ($1::int || ' days')::interval - spread.offset_seconds,
                  now() - ($1::int || ' days')::interval - spread.offset_seconds
           FROM units u
           JOIN properties p ON p.id = u.property_id
           CROSS JOIN LATERAL (SELECT id FROM currencies WHERE code = 'USD' LIMIT 1) cur
           CROSS JOIN LATERAL (
             SELECT id FROM customer_profiles
             WHERE email LIKE 'load-%' ORDER BY id OFFSET ($1::int % 1000) LIMIT 1
           ) cp
           -- Seconds within the rung's day, deterministic per unit. See the note above the rung loop.
           CROSS JOIN LATERAL (
             SELECT ((('x' || substr(md5(u.id::text), 1, 8))::bit(32)::bigint & 2147483647)
                     % 86400) * interval '1 second' AS offset_seconds
           ) spread
           WHERE p.slug LIKE 'load-property-%'`,
          [rung, Math.floor((perUnit * spacing) / 2), spacing],
        );

        process.stdout.write(`\r  bookings: rung ${rung + 1}/${perUnit} `);
      }

      process.stdout.write('\r');
    });

    await step('audit_log', () =>
      exec(
        `INSERT INTO audit_log (actor_user_id, actor_role, action, subject_type, subject_id,
                                before, after, created_at)
         SELECT u.id, 'support_agent'::user_role,
                (ARRAY['booking.confirmed','booking.cancelled','partner.approved',
                       'settings.updated','staff.invited'])[1 + (n % 5)],
                'booking', NULL,
                '{"status":"pending_confirmation"}'::jsonb,
                '{"status":"confirmed"}'::jsonb,
                -- Days AND seconds from the counter: 900 distinct timestamps over twenty million
                -- rows is 22,000 rows tied on the audit log's own sort key.
                now() - ((n % 900) || ' days')::interval - ((n % 86400) * interval '1 second')
         FROM generate_series(1, $1) AS n
         CROSS JOIN LATERAL (
           SELECT id FROM users WHERE email LIKE 'load-%' ORDER BY id OFFSET (n % 500) LIMIT 1
         ) u`,
        [counts.auditLog],
      ),
    );

    /*
      Ledger entries in BALANCED groups.

      `ledger_entries_must_balance` is a deferred constraint trigger checking that debits equal
      credits per `entry_group_id`. Four legs per group — two debit, two credit, same amounts — so
      every group balances at commit. A generator that ignored this would abort on its first group.
    */
    await step('ledger_entries', async () => {
      const groups = Math.ceil(counts.ledgerEntries / LEDGER_LEGS_PER_GROUP);

      /*
        Chunked into separate TRANSACTIONS, and this one is not about speed.

        `ledger_entries_must_balance` is a CONSTRAINT TRIGGER, DEFERRABLE INITIALLY DEFERRED, FOR
        EACH ROW. PostgreSQL therefore queues one after-trigger event per inserted row and holds the
        whole queue until COMMIT. Twenty million rows in one transaction means twenty million queued
        events before a single check runs — the queue spills to disk and the commit crawls. Bounded
        chunks keep the queue at CHUNK × legs.

        Worth knowing beyond this script: the same shape applies to any future bulk backfill of a
        ledger. It is a property of the constraint, not of the generator.
      */
      for (let done = 0; done < groups; done += LEDGER_GROUP_CHUNK) {
        const size = Math.min(LEDGER_GROUP_CHUNK, groups - done);

        await exec(
          `INSERT INTO ledger_entries (entry_group_id, account, direction, amount, currency_id,
                                       fx_rate_to_syp, amount_syp, description, created_at)
           SELECT g.group_id,
                  -- The four legs a captured booking actually posts, in the order
                  -- LedgerService.postBookingPayment writes them. No backticks in here:
                  -- one would terminate the template literal this SQL lives in.
                  (ARRAY['customer_payment','wallet_debit','safra_commission_customer',
                         'partner_payable']::ledger_account[])[leg],
                  (CASE WHEN leg <= 2 THEN 'debit' ELSE 'credit' END)::ledger_direction,
                  '100.00', cur.id, '13000.00000000', '1300000.00',
                  'Load-test leg ' || leg,
                  now() - ((g.n % 900) || ' days')::interval
                    - ((g.n % 86400) * interval '1 second')
           FROM (
             SELECT n, gen_random_uuid() AS group_id FROM generate_series(1, $1) AS n
           ) g
           CROSS JOIN generate_series(1, $2) AS leg
           CROSS JOIN LATERAL (SELECT id FROM currencies WHERE code = 'USD' LIMIT 1) cur`,
          [size, LEDGER_LEGS_PER_GROUP],
        );

        process.stdout.write(
          `\r  ledger_entries: ${((done + size) * LEDGER_LEGS_PER_GROUP).toLocaleString('en')} legs `,
        );
      }

      process.stdout.write('\r');
    });

    await step('ANALYZE', () => exec('ANALYZE'));

    const summary = await pool.query<{ t: string; n: string; size: string }>(
      `SELECT t, n::text, pg_size_pretty(pg_total_relation_size(t)) AS size
       FROM (
         SELECT 'users' t, count(*) n FROM users
         UNION ALL SELECT 'customer_profiles', count(*) FROM customer_profiles
         UNION ALL SELECT 'partners', count(*) FROM partners
         UNION ALL SELECT 'partner_applications', count(*) FROM partner_applications
         UNION ALL SELECT 'properties', count(*) FROM properties
         UNION ALL SELECT 'units', count(*) FROM units
         UNION ALL SELECT 'availability_days', count(*) FROM availability_days
         UNION ALL SELECT 'bookings', count(*) FROM bookings
         UNION ALL SELECT 'audit_log', count(*) FROM audit_log
         UNION ALL SELECT 'ledger_entries', count(*) FROM ledger_entries
       ) counted`,
    );

    console.log('\nGenerated:');

    for (const row of summary.rows) {
      console.log(
        `  ${row.t.padEnd(18)} ${Number(row.n).toLocaleString('en').padStart(12)}  ${row.size}`,
      );
    }

    console.log(`\nTotal ${((Date.now() - started) / 1000 / 60).toFixed(1)} minutes.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
