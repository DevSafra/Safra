import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { adminMessages } from './admin.js';
import { LOCALES } from './locales.js';
import { partnerMessages } from './partner.js';
import {
  STATUS_CATALOGUE,
  STATUS_VOCABULARIES,
  statusWord,
  statusWords,
  unambiguousStatusWords,
  type StatusVocabulary,
} from './statuses.js';
import { webMessages } from './web.js';

/**
 * One state, one word, in every application.
 *
 * ## What this is holding
 *
 * Bashar's decision of 2026-09-08. Before it, each app owned a copy of every status vocabulary and
 * **22 of the 58 states they shared were named differently by two of them** — an operator saying
 * «قيد المراجعة» down the telephone while the guest read «قيد الدراسة» on their own screen.
 *
 * The fix is structural rather than tested: every app's table is now a call to `statusWords`, so
 * there is no second copy to edit out of step. What is left for a test is the two ways that could
 * still be undone — somebody writing a literal table back into an app's catalogue, and somebody
 * adding a state to the canonical file in one language only.
 */
const REPO = join(import.meta.dirname, '..', '..', '..');

describe('the canonical status catalogue', () => {
  it('gives every state a word in every language', () => {
    const missing: string[] = [];

    for (const vocabulary of STATUS_VOCABULARIES) {
      for (const [value, words] of Object.entries(STATUS_CATALOGUE[vocabulary])) {
        for (const locale of LOCALES) {
          if (!words[locale] || words[locale].trim() === '') {
            missing.push(`${vocabulary}.${value} [${locale}]`);
          }
        }
      }
    }

    expect(
      missing,
      'A state with no word in one language is how a German customer comes to read Arabic — the ' +
        'failure docs/i18n.md opens with. All three sit side by side in statuses.ts for exactly ' +
        'this reason.',
    ).toStrictEqual([]);
  });

  /**
   * No two states in one vocabulary share a word.
   *
   * The console has its own version of this over its own tables; this one covers the canonical
   * file, in every language, so a translation that collapses two states is caught in the file
   * where the collapse would happen rather than on the screen where it would be read.
   */
  it('never gives two states in one vocabulary the same word', () => {
    const clashes: string[] = [];

    for (const vocabulary of STATUS_VOCABULARIES) {
      for (const locale of LOCALES) {
        const byWord = new Map<string, string[]>();

        for (const [value, word] of Object.entries(statusWords(vocabulary, locale))) {
          byWord.set(word, [...(byWord.get(word) ?? []), value]);
        }

        for (const [word, values] of byWord) {
          if (values.length > 1) {
            clashes.push(`${vocabulary} [${locale}]: «${word}» is ${values.join(', ')}`);
          }
        }
      }
    }

    expect(clashes).toStrictEqual([]);
  });

  /**
   * A dispute's outcome names the party it went to, in every language.
   *
   * Bashar, in the same decision: *«If a dispute is resolved in favour of the customer, the
   * customer should clearly see that outcome. If a dispute is resolved in favour of the partner,
   * the customer should clearly see that outcome.»*
   *
   * Asserted as «the two outcomes do not read the same, and each names a party» rather than by
   * pinning the sentences: pinning would make this a copy of the catalogue and it would pass
   * against «Settled» and «Declined», which is what it replaced. What must hold is that a reader
   * can tell WHICH WAY it went — so the two words must differ from each other and each must carry
   * the word for its party.
   */
  it('states which party a dispute was decided for', () => {
    const parties: Record<string, { customer: string; partner: string }> = {
      ar: { customer: 'العميل', partner: 'الشريك' },
      en: { customer: 'customer', partner: 'partner' },
      de: { customer: 'Kunden', partner: 'Partners' },
    };

    for (const locale of LOCALES) {
      const resolved = statusWord('disputeStatus', 'resolved', locale);
      const rejected = statusWord('disputeStatus', 'rejected', locale);
      const words = parties[locale];

      expect(words, `no party words for ${locale}`).toBeDefined();
      expect(resolved, `${locale}: an upheld complaint names the customer`).toContain(
        words?.customer ?? '',
      );
      expect(rejected, `${locale}: a rejected complaint names the partner`).toContain(
        words?.partner ?? '',
      );
      expect(resolved, `${locale}: the two outcomes must not read the same`).not.toBe(
        rejected,
      );
    }
  });

  /**
   * Every app reads the canonical word — checked against what its catalogue actually returns.
   *
   * This is the assertion that would fail if somebody pasted a literal table back into an app's
   * copy. It compares the RESOLVED value rather than the source text, so it does not care how the
   * catalogue is written, only that the word a reader gets is the canonical one.
   *
   * The console's `disputeKind` is the one documented exception and is asserted as a composition
   * rather than an equality: it appends «(EC-006)» so an operator can cross-reference §10, which
   * is the console adding to a canonical label rather than holding a second vocabulary.
   */
  it('is what all three applications actually resolve', () => {
    const admin = adminMessages('ar');
    const partner = partnerMessages('ar');
    const web = webMessages('ar');

    const TABLES: readonly (readonly [
      StatusVocabulary,
      string,
      Record<string, string> | undefined,
    ])[] = [
      ['bookingStatus', 'admin.bookingStatus', admin.bookingStatus],
      ['paymentStatus', 'admin.enums.paymentStatus', admin.enums.paymentStatus],
      ['disputeStatus', 'admin.enums.disputeStatus', admin.enums.disputeStatus],
      ['giftCardStatus', 'admin.enums.giftCardStatus', admin.enums.giftCardStatus],
      ['payoutStatus', 'admin.enums.payoutStatus', admin.enums.payoutStatus],
      [
        'payoutAccountStatus',
        'admin.enums.payoutAccountStatus',
        admin.enums.payoutAccountStatus,
      ],
      ['propertyStatus', 'admin.enums.propertyStatus', admin.enums.propertyStatus],
      ['violationKind', 'admin.enums.violationKind', admin.enums.violationKind],
      ['violationStage', 'admin.enums.violationStage', admin.enums.violationStage],
      ['disputeStatus', 'partner.disputeStatus', partner.disputeStatus],
      ['disputeKind', 'partner.disputeKind', partner.disputeKind],
      ['payoutStatus', 'partner.payoutStatus', partner.payoutStatus],
      ['propertyStatus', 'partner.propertyStatus', partner.propertyStatus],
      ['violationKind', 'partner.violationKind', partner.violationKind],
      ['violationKind', 'partner.violations.kind', partner.violations.kind],
      ['violationStage', 'partner.violations.stage', partner.violations.stage],
      [
        'payoutAccountStatus',
        'partner.payoutAccounts.status',
        partner.payoutAccounts.status,
      ],
    ];

    const wrong: string[] = [];

    for (const [vocabulary, where, table] of TABLES) {
      if (!table) {
        wrong.push(`${where} is missing entirely`);
        continue;
      }

      for (const [value, word] of Object.entries(table)) {
        const canonical = statusWord(vocabulary, value, 'ar');

        if (word !== canonical) {
          wrong.push(`${where}.${value}: «${word}» should be «${canonical}»`);
        }
      }
    }

    /* The console's kind labels: the canonical word plus its EC code, not a different word. */
    for (const [value, word] of Object.entries(admin.enums.disputeKind)) {
      const canonical = statusWord('disputeKind', value, 'ar');

      if (!word.startsWith(canonical)) {
        wrong.push(
          `admin.enums.disputeKind.${value}: «${word}» does not start «${canonical}»`,
        );
      }
    }

    expect(
      wrong,
      'A status word here disagrees with the canonical catalogue. Point the table at ' +
        '`statusWords(vocabulary, locale)` rather than writing the words out — the whole reason ' +
        'the catalogue exists is that three copies of a word become three different words.',
    ).toStrictEqual([]);

    /* And the customer catalogue must no longer HOLD these tables, or a copy could grow back. */
    const held = [
      'disputeStatuses' in web,
      'status' in web.account,
      'paymentStatus' in web.account,
      'giftStatus' in web.account,
    ];

    expect(
      held,
      'The customer catalogue is holding a status table again. Statuses come from statuses.ts; ' +
        'the JSON keeps `disputeReasons`, which is the FORM’s wording and a different job.',
    ).toStrictEqual([false, false, false, false]);
  });

  /**
   * The console's audit map agrees with the canonical catalogue, except where it cannot.
   *
   * ## Why this needs its own assertion
   *
   * سجل التدقيق resolves a payload value through one flat map, keyed by VALUE, because a payload is
   * one column read across every action in the log. It was written out by hand for that reason —
   * and twenty of its words had drifted from the vocabularies by 2026-09-08: an operator read «قيد
   * المراجعة» on an audit row about a dispute every screen calls «قيد الدراسة». The map now spreads
   * `unambiguousStatusWords`, so the words that CAN agree do.
   *
   * ## The exceptions are enumerated, not tolerated
   *
   * Four values genuinely mean two things — `rejected` is a refused document and a dispute decided
   * for the partner. Those are listed here by name, so a FIFTH divergence is a failure rather than
   * a precedent. That is the difference between an exception and a leak.
   */
  it('does not let the audit map drift from the vocabularies', () => {
    const payload = adminMessages('ar').enums.payloadValue;
    const canonical = unambiguousStatusWords('ar');

    /*
      Each of these is one enum label meaning two states in two vocabularies — see the note beside
      them in the console's catalogue. `active` is «سارية» for a gift card and «نشط» for a coupon;
      one column cannot be both.
    */
    const DELIBERATE = new Set(['rejected', 'active', 'suspended', 'cancelled']);

    const drifted = Object.entries(canonical)
      .filter(([value, word]) => {
        const shown = payload[value];

        return shown !== undefined && shown !== word && !DELIBERATE.has(value);
      })
      .map(([value, word]) => `${value}: audit «${payload[value]}» vs «${word}»`);

    expect(
      drifted.sort(),
      'The audit log names a state differently from every screen that shows it. Remove the ' +
        'hand-written entry and let `unambiguousStatusWords` supply it — or, if the value really ' +
        'means two things, add it to DELIBERATE here with the reason.',
    ).toStrictEqual([]);

    /* And the control: every deliberate exception is still IN the map, so the list cannot rot. */
    expect(
      [...DELIBERATE].filter((value) => payload[value] === undefined).sort(),
      'A deliberate exception no longer exists in the audit map. Remove it from DELIBERATE — a ' +
        'stale entry silently excuses the next value that shares the name.',
    ).toStrictEqual([]);
  });

  /**
   * And nothing in the three apps writes a status word by hand.
   *
   * The sweep the assertion above cannot make: a component that hard-codes «قيد الدراسة» rather
   * than reading the catalogue is invisible to a comparison of catalogues. Read from the SOURCE,
   * because the binding between a screen and a status word is the literal itself.
   */
  it('is not bypassed by a status word written into a component', () => {
    const files = readSource();
    const offenders: string[] = [];

    for (const vocabulary of STATUS_VOCABULARIES) {
      for (const word of Object.values(statusWords(vocabulary, 'ar'))) {
        /* Short words appear inside ordinary prose; only distinctive ones can be swept. */
        if (word.length < 8) continue;

        for (const [path, source] of files) {
          if (source.includes(word)) offenders.push(`«${word}» in ${path}`);
        }
      }
    }

    expect(
      [...new Set(offenders)].sort(),
      'A status word is written into an application rather than read from the catalogue. It ' +
        'will not move when the canonical word does, which is how the divergence this file ' +
        'closes came about in the first place.',
    ).toStrictEqual([]);
  });
});

/** Every non-test source file in the three front ends, as [path, contents]. */
function readSource(): (readonly [string, string])[] {
  const listed = execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      'apps/admin/src/**/*.ts',
      'apps/admin/src/**/*.tsx',
      'apps/partner/src/**/*.ts',
      'apps/partner/src/**/*.tsx',
      'apps/web/src/**/*.ts',
      'apps/web/src/**/*.tsx',
    ],
    { cwd: REPO, encoding: 'utf8' },
  )
    .split('\n')
    .filter((path) => path !== '' && !path.includes('.test.'));

  expect(listed.length, 'the sweep found source to read').toBeGreaterThan(50);

  /*
    Comments STRIPPED, and that is not a convenience.

    This codebase quotes the Arabic in its comments on purpose — «the word already existed —
    `account.status.pending_payment` = «بانتظار الدفع» — and nothing reached it» is a note
    explaining a fix, not a hard-coded label. The first version of this sweep reported sixteen of
    them and none was a bypass. A sweep that cries wolf gets switched off, which is worse than not
    having it.
  */
  return listed.map(
    (path) =>
      [
        path,
        readFileSync(join(REPO, path), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/^\s*\/\/.*$/gm, ' '),
      ] as const,
  );
}
