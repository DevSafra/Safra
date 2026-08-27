import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every staff-reachable route either ENFORCES a city scope or is declared as not needing one.
 *
 * ## Why this file exists
 *
 * `O-sec-13`: staff scope was recorded as «enforced across 9 registries, the dashboard, all
 * reports, the finance ledger and the export» on 2026-08-04, and that claim was falsified FOUR
 * times — `review.service.ts` (2026-08-20), `partner-contract.service.ts` (2026-08-23), and
 * `booking-detail.service.ts` + `enforcement.service.ts` (2026-08-27). Every one was found by
 * somebody looking, never by a check. The register's own words: «scope coverage is unknown, not
 * complete».
 *
 * A fifth was then found the same way — the systematic pass on 2026-08-27 turned up ELEVEN more,
 * including the booking write actions, refunds, payouts, review moderation and partner onboarding.
 * That is the point at which enumerating by hand stops being a method.
 *
 * ## What it asserts, and what it deliberately does not
 *
 * It asserts that no staff route is UNDECLARED. Every route either reaches a scope helper, or has
 * an entry in `NO_CITY` saying why it has no geography to narrow by. It does not and cannot assert
 * that the enforcement is CORRECT — a `scopeFilter` on the wrong column would satisfy it. That is
 * what the integration suites are for: `booking-scope`, `enforcement-scope`, `scope-enforcement`,
 * `review-scope`, `partner-contract-scope`.
 *
 * The two halves answer different questions and both are needed. This one answers «is there a
 * route nobody has thought about», which is the question that was being answered by accident.
 *
 * ## Why the source and not the running app
 *
 * Because the failure is a route that was never wired to a scope at all, and a runtime probe can
 * only test the routes somebody remembered to probe — which is the same enumeration problem one
 * layer down. Reading the tree finds the route added this morning.
 */
const API = join(import.meta.dirname, '..');

/** Permissions that only ever belong to a PARTNER or a customer acting on their own records. */
const OWN_SCOPED = /_OWN\b|_MANAGE_OWN\b|RESPOND_AS_PARTNER|REVIEW_CREATE|CUSTOMER_/;

/**
 * Routes that touch nothing with a city, with the reason each one has none.
 *
 * This is an ALLOW-LIST and it is the part that decays, so every entry names the resource rather
 * than the route's convenience. `UNSCOPED_RESOURCES` in `@safra/contracts` is the authority:
 * the audit log (deliberately, permanently — «a scoped audit log is not a trustworthy audit log»),
 * settings, staff administration, geography, customers, and the platform-wide value instruments —
 * wallet, gift cards and coupons, none of which belongs to a city.
 *
 * An entry here is a claim that the resource has NO geography. If one grows a city column, the
 * entry stops being true and this list is where somebody has to come and say so.
 */
const NO_CITY: readonly { readonly route: RegExp; readonly why: string }[] = [
  { route: /admin\/audit-log/, why: 'audit_log — unscoped by decision, permanently' },
  { route: /admin\/jobs/, why: 'scheduled jobs are platform-level' },
  { route: /admin\/settings/, why: 'settings — platform-level' },
  { route: /admin\/grants/, why: 'settings — the standing-grant register' },
  { route: /admin\/property-types/, why: 'reference data, like geo' },
  { route: /admin\/cities/, why: 'geo — the cities themselves' },
  { route: /admin\/geo/, why: 'geo' },
  { route: /admin\/fx-rates/, why: 'currencies — platform-level' },
  { route: /admin\/staff(-roles)?/, why: 'staff administration — unscoped by decision' },
  { route: /admin\/me/, why: "the reader's own display preferences" },
  { route: /admin\/customers/, why: 'customers — a customer belongs to no city' },
  { route: /admin\/wallet/, why: 'wallet — a platform-wide value instrument' },
  { route: /admin\/gift-cards/, why: 'gift_cards — a platform-wide value instrument' },
  { route: /admin\/coupons/, why: 'coupons — a platform-wide value instrument' },
  { route: /admin\/emergency/, why: 'Emergency Mode is platform-wide (EC-009)' },
  {
    route: /admin\/sanctions\/(status|import)/,
    why: 'the sanctions FEED, not a partner',
  },
  {
    route: /admin\/exports/,
    why: 'gated by REQUESTER; the file itself was built under the requester’s own scope',
  },
  {
    route: /payouts\/accrue/,
    why: 'the scheduled accrual sweep — it names no partner and takes no actor',
  },
  {
    route: /admin\/bookings\/export/,
    why: 'BookingExportService applies the scope when it builds the file',
  },
];

/** The helpers that constitute enforcement. */
const ENFORCES =
  /scopeFilter|scopeCondition|assertCanWrite|assertCanRead|canReadInCity|canWriteInCity|requirePartnerId|resolveBookingScope|assertReadable/;

function walk(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }

  return found;
}

const FILES = walk(API).filter(
  (file) => !file.includes('.test.') && !file.includes('.spec.'),
);

/**
 * Every service method in the API, with its body — following `this.x(…)` two levels deep.
 *
 * Two, because the real call graph needs it: `staffCheckIn` delegates to `move`, which delegates to
 * `load`, and `load` is where the predicate lives. One level reported seven booking transitions as
 * unenforced when they had just been scoped — a false alarm, but the same arithmetic hides a real
 * one in the other direction, so the depth is set by the deepest delegation that actually exists
 * rather than by taste.
 *
 * Each level widens what counts as "enforced", so this is the loosest the sweep may be. Whether the
 * enforcement is CORRECT is the integration suites' question, not this one's.
 */
function serviceBodies(): Map<string, string> {
  const bodies = new Map<string, string>();

  for (const file of FILES.filter((f) => f.endsWith('.service.ts'))) {
    const source = readFileSync(file, 'utf8');
    const cls = /export class (\w+)/.exec(source)?.[1];

    if (!cls) continue;

    const starts: [string, number][] = [];

    for (const m of source.matchAll(/^ {2}(?:private |public )?(?:async )?(\w+)\(/gm)) {
      starts.push([m[1] ?? '', m.index]);
    }

    for (const [index, [name, at]] of starts.entries()) {
      const end = starts[index + 1]?.[1] ?? source.length;

      bodies.set(`${cls}.${name}`, source.slice(at, end));
    }
  }

  /* Fold each method's own `this.other(…)` callees into its text, twice. */
  const fold = (source: Map<string, string>): Map<string, string> => {
    const out = new Map<string, string>();

    for (const [key, body] of source) {
      const cls = key.slice(0, key.indexOf('.'));
      let text = body;

      for (const call of body.matchAll(/this\.(\w+)\(/g)) {
        text += source.get(`${cls}.${call[1] ?? ''}`) ?? '';
      }

      out.set(key, text);
    }

    return out;
  };

  return fold(fold(bodies));
}

interface Route {
  readonly file: string;
  readonly route: string;
  readonly permission: string;
  readonly enforced: boolean;
}

function routes(): Route[] {
  const bodies = serviceBodies();
  const found: Route[] = [];

  for (const file of FILES.filter((f) => f.endsWith('.controller.ts'))) {
    const source = readFileSync(file, 'utf8');

    /*
      Split at each `@Controller`, because a file may hold several.
      
      `reviews/review.controller.ts` holds three — `reviews`, `partner/reviews` and
      `admin/reviews` — and taking the first prefix for the whole file filed the MODERATION routes
      under `/reviews/…`. That is not a cosmetic mislabel: `NO_CITY` matches on the route string,
      so a wrong prefix is a route that could be excused by somebody else's entry.
    */
    const segments = source
      .split(/(?=@Controller\()/)
      .filter((segment) => segment.startsWith('@Controller('));

    for (const segment of segments) {
      const prefix = /@Controller\('([^']*)'\)/.exec(segment)?.[1] ?? '';
      const injected = new Map<string, string>();

      for (const m of segment.matchAll(/private readonly (\w+):\s*(\w+)/g)) {
        injected.set(m[1] ?? '', m[2] ?? '');
      }

      for (const m of segment.matchAll(
        /@(Get|Post|Patch|Put|Delete)\(([^)]*)\)([\s\S]*?)\n {2}\}/g,
      )) {
        const [, verb, arg, handler] = m;
        const path = /'([^']*)'/.exec(arg ?? '')?.[1] ?? '';
        const permission = /@RequirePermissions\(([^)]*)\)/
          .exec(handler ?? '')?.[1]
          ?.replace(/\s+/g, ' ');

        /* No permission means it is `@Public()` or authentication-only — not a staff surface. */
        if (!permission) continue;

        let text = handler ?? '';

        for (const call of (handler ?? '').matchAll(/this\.(\w+)\.(\w+)\(/g)) {
          const cls = injected.get(call[1] ?? '') ?? call[1] ?? '';

          text += bodies.get(`${cls}.${call[2] ?? ''}`) ?? '';
        }

        found.push({
          file: file.slice(API.length + 1),
          route: `${verb} /${prefix}/${path}`.replace(/\/+$/, ''),
          permission,
          enforced: ENFORCES.test(text),
        });
      }
    }
  }

  return found;
}

describe('city scope reaches every staff route', () => {
  const all = routes();

  /** The sweep is only worth its green if it is looking at the whole surface. */
  it('finds the routes it is supposed to be checking', () => {
    expect(all.length, 'staff-reachable routes carrying a permission').toBeGreaterThan(
      150,
    );

    for (const marker of [
      'Post /admin/bookings/:reference/compensate',
      'Post /bookings/:reference/cancel',
      'Post /admin/payouts/:id/paid',
      'Post /admin/reviews/:reference/moderate',
      'Post /admin/partner-onboarding',
    ]) {
      expect(
        all.some((route) => route.route === marker),
        `${marker} is in the swept set`,
      ).toBe(true);
    }
  });

  it('leaves no staff route undeclared', () => {
    const undeclared = all
      .filter((route) => !route.enforced)
      .filter((route) => !OWN_SCOPED.test(route.permission))
      .filter((route) => !NO_CITY.some((entry) => entry.route.test(route.route)))
      .map((route) => `${route.route}  [${route.permission}]  ${route.file}`);

    expect(
      [...new Set(undeclared)],
      'These reach business data and neither enforce a city scope nor appear in `NO_CITY`. ' +
        'Either narrow the query with `scopeFilter`/`scopeCondition` and guard the write with ' +
        '`assertCanWrite`, or add an entry to `NO_CITY` saying which resource has no geography.',
    ).toStrictEqual([]);
  });

  /**
   * The opposite control.
   *
   * Every assertion above passes if `ENFORCES` matches everything, if `routes()` returns nothing,
   * or if `NO_CITY` grew a pattern broad enough to cover the platform. So the sweep is asked to
   * recognise an unscoped route, and `NO_CITY` is asked not to swallow a scoped one.
   */
  it('would notice a route that enforces nothing', () => {
    const scoped = all.filter((route) => route.enforced);

    expect(scoped.length, 'the sweep sees enforcement where it exists').toBeGreaterThan(
      40,
    );

    const swallowed = scoped.filter((route) =>
      NO_CITY.some((entry) => entry.route.test(route.route)),
    );

    /*
      A route that BOTH enforces a scope and is declared as having no city is a contradiction: one
      of the two is wrong, and leaving it is how an allow-list starts hiding things.
    */
    expect(
      swallowed.map((route) => route.route),
      'these enforce a scope AND claim to have no city — remove the `NO_CITY` entry',
    ).toStrictEqual([]);
  });
});
