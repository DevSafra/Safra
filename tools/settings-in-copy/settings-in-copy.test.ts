import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { SETTINGS } from '../../packages/db/src/seed/reference.js';

/**
 * No operating value the Super Admin can change is written into a sentence.
 *
 * Bashar, 2026-09-07: *"I do not want any customer-facing, partner-facing or admin-facing
 * operational values hardcoded in the interface when those values can be changed through the Super
 * Admin settings. Values such as SAFRA fees, commissions, SLA compensations, fines, confirmation
 * windows should always be derived from the active configuration rather than embedded in static
 * strings."*
 *
 * ## Why a test and not a habit
 *
 * The five that were found had all been written deliberately, by somebody who knew the value on the
 * day they wrote it. «مهلة ساعتين — الغرامة 10$» over the acceptance queue, «عمولة الشريك 7٪ + رسوم
 * خدمة 1.99$» on two console cards, «ليؤكّده خلال 120 دقيقة» and «تُغلق الساعة 17:00» in the terms,
 * «نؤكد خلال ساعتين» on the home page. None was a mistake at the time; each became one the moment a
 * setting could be edited, and nothing anywhere would have said so. A rule nobody can see being
 * broken decays, so this reads the SEEDED settings — the platform's own source of truth — rather
 * than a list somebody has to remember to update.
 *
 * ## It reads the seed, so a NEW setting is covered the day it is added
 *
 * A hand-written list of forbidden numbers would protect the five that were found and nothing else.
 * `SETTINGS` is what `db:seed` writes, so adding a rule to the platform automatically extends this.
 */

/** Every catalogue a person reads from. Comments in these files are not user-facing. */
const CATALOGUES = [
  'packages/i18n/src/messages/web/ar.json',
  'packages/i18n/src/messages/web/en.json',
  'packages/i18n/src/messages/web/de.json',
  'packages/i18n/src/messages/partner/ar.ts',
  'packages/i18n/src/messages/admin/ar.ts',
  'packages/i18n/src/messages/email/ar.ts',
  'packages/i18n/src/messages/email/en.ts',
  'packages/i18n/src/messages/email/de.ts',
];

/**
 * The settings whose value is an OPERATING FIGURE a sentence could quote.
 *
 * A boolean cannot be quoted as a number and a routing table is not prose, so both are skipped —
 * including them would make every «true» in the copy a finding and teach the reader to ignore this.
 */
const NUMERIC_SETTINGS = SETTINGS.filter(
  (s) => typeof s.value === 'number' && Number.isFinite(s.value),
) as readonly { key: string; value: number }[];

/**
 * Every way a value could plausibly be WRITTEN, including the units a sentence would use.
 *
 * `0.07` is never printed as itself — it is printed as «7٪», and «مهلة 120 دقيقة» is printed as
 * «ساعتين». A check that looked only for the stored form would have missed four of the five that
 * were actually there, which is the difference between a sweep and a formality.
 */
function spellings(value: number): readonly string[] {
  const out = new Set<string>();

  const add = (n: number) => {
    if (!Number.isFinite(n)) return;
    out.add(Number.isInteger(n) ? String(n) : String(n));
  };

  add(value);
  /* A fraction shown as a percentage: 0.07 → 7. */
  if (value > 0 && value < 1) add(value * 100);
  /* Minutes shown as hours: 120 → 2. */
  if (value >= 60 && value % 60 === 0) add(value / 60);

  /*
    Two characters minimum. A single digit matches a version number, a step number and every «2»
    in the catalogue, and a check that cries wolf is one somebody switches off.
  */
  return [...out].filter((s) => s.replace('.', '').length >= 2);
}

/** Single-line string literals only — a value quoted in a code comment is not user-facing. */
function literals(
  source: string,
  file: string,
): readonly { line: number; text: string }[] {
  if (file.endsWith('.json')) {
    return source.split('\n').flatMap((line, i) => {
      const match = /:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/.exec(line);
      return match?.[1] ? [{ line: i + 1, text: match[1] }] : [];
    });
  }

  return source.split('\n').flatMap((line, i) => {
    /* A `//` or a line inside a block comment is skipped: only assignments count. */
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
      return [];
    }

    return [...line.matchAll(/'((?:[^'\\]|\\.)*)'/g)].flatMap((m) =>
      m[1] ? [{ line: i + 1, text: m[1] }] : [],
    );
  });
}

/**
 * The units that make a number an OPERATING figure rather than a coincidence.
 *
 * «حتى 10 ميغابايت» is an upload limit that happens to share a digit with the first fine, and a
 * check that reported it would be a check somebody switches off. What this class is actually about
 * is a settings value presented AS money, AS a percentage or AS a length of time — so the number
 * has to be next to one of those to count.
 *
 * A bare figure with no unit is not covered, and that is deliberate rather than an oversight: the
 * money rule already forbids an amount written without its currency, and the sweep that holds it
 * runs beside this one.
 */
const UNITS =
  /[$€£٪%]|ل\.س|USD|SYP|دقيقة|دقائق|دقيقت(?:ان|ين)|ساعة|ساعات|ساعت(?:ان|ين)|minute|hour|Minute|Stunde/;

/**
 * Strings that quote a number which is NOT a Super Admin setting, each with a check of its own.
 *
 * The rule Bashar set is about values *"that can be changed through the Super Admin settings"*, and
 * two strings quote a figure that merely COLLIDES with one. Exempting them outright would be the
 * decay this codebase already has a name for — an exemption whose reason is written once while the
 * code moves underneath it — so each entry states a property that can be re-checked, and the tests
 * below check it. An entry whose reason stops holding fails here rather than going quiet.
 */
const EXEMPT: readonly {
  readonly text: string;
  readonly why: string;
  /** A source file whose constant this string quotes, and the declaration that must still match. */
  readonly pinnedTo?: { readonly file: string; readonly declaration: RegExp };
}[] = [
  {
    text: 'كسر بين 0 و 1 — نسبة 7٪ تُكتب 0.07',
    why: 'A format example on الإعدادات, which prints the live value beside it',
  },
  {
    text: 'أرسلنا رمزًا من 6 أرقام إلى بريدك الإلكتروني. ينتهي خلال 10 دقائق.',
    why: 'The sign-in code lifetime — a constant in the API, not a settings row',
    pinnedTo: {
      file: 'apps/api/src/auth/login-code.service.ts',
      declaration: /const CODE_TTL_MINUTES = 10;/,
    },
  },
];

describe('every exemption still describes what it claims to', () => {
  it('a format example shows the conversion rather than asserting a rate', () => {
    const example = EXEMPT.find((e) => e.pinnedTo === undefined);

    expect(
      example,
      'the format-hint exemption is gone; drop this test with it',
    ).toBeDefined();
    /* Both forms: the percentage a reader means AND the fraction the field accepts. */
    expect(example!.text).toMatch(/٪|%/);
    expect(example!.text).toMatch(/0\.\d/);
  });

  it.each(EXEMPT.filter((e) => e.pinnedTo))(
    'the number in «$why» still matches the constant it quotes',
    ({ pinnedTo }) => {
      /*
        This is the half that makes the exemption worth having. «ينتهي خلال 10 دقائق» is excused
        because it quotes `CODE_TTL_MINUTES`, not `partner.first_violation_fine` — and the day
        somebody changes that constant to fifteen, the copy becomes wrong in exactly the way this
        whole file exists to prevent. So the claim is verified against the source rather than
        believed: a bare exemption would have gone quiet at precisely that moment.
      */
      const source = readFileSync(pinnedTo!.file, 'utf8');

      expect(
        pinnedTo!.declaration.test(source),
        `${pinnedTo!.file} no longer declares the value this copy quotes — update both together.`,
      ).toBe(true);
    },
  );
});

describe('no Super Admin setting is written into the interface', () => {
  it('the seed actually carries numeric operating values', () => {
    /*
      A guard on the guard. If `SETTINGS` were ever restructured so this filter found nothing, every
      assertion below would pass over an empty list and report coverage of a rule it never checked.
    */
    expect(NUMERIC_SETTINGS.length).toBeGreaterThanOrEqual(5);
    expect(NUMERIC_SETTINGS.map((s) => s.key)).toContain(
      'booking.confirmation_window_minutes',
    );
  });

  it.each(CATALOGUES)('%s quotes no configured value', (file) => {
    const source = readFileSync(file, 'utf8');
    const found: string[] = [];

    for (const { line, text } of literals(source, file)) {
      /* A sentence carrying a placeholder is already deriving its value. */
      if (text.includes('{')) continue;
      /* Arabic-Indic digits are not used for figures in this platform — see `numerals.ts`. */
      if (!/\d/.test(text)) continue;
      /* A number with no money, percentage or duration beside it is a different quantity. */
      if (!UNITS.test(text)) continue;
      if (EXEMPT.some((e) => e.text === text)) continue;

      for (const setting of NUMERIC_SETTINGS) {
        for (const spelling of spellings(setting.value)) {
          /* Bounded so `10` does not match inside `2010`, `1.05` or `310`. */
          const bounded = new RegExp(
            `(?<![\\d.])${spelling.replace('.', '\\.')}(?![\\d.])`,
          );

          if (bounded.test(text)) {
            found.push(
              `${file}:${line}  ${setting.key}=${setting.value}  «${text.slice(0, 90)}»`,
            );
          }
        }
      }
    }

    expect(
      [...new Set(found)],
      'A value a super admin can change is written into a sentence. Derive it: the readers in ' +
        '`@safra/contracts/operating-rules` take the settings map the surface already receives, ' +
        'and the copy takes a {placeholder}. Where the sentence describes a PAST event — a ' +
        'violation judged by the window in force then — remove the figure instead, because ' +
        'interpolating today’s value would replace one wrong statement with another.',
    ).toEqual([]);
  });
});

/**
 * A duration written as an Arabic DUAL WORD, which carries no digits at all.
 *
 * This is the hole the digit sweep above cannot see, and it is not hypothetical: six strings went
 * through it on 2026-09-07, four of them on the customer application — «مهلة أقصاها ساعتان» on the
 * home page, the property page, the checkout note and the pending-booking steps, plus two on the
 * console. Every one states the confirmation window, every one is correct at exactly 120 minutes,
 * and none contains a single digit for the sweep to match on.
 *
 * «ساعتان» and «ساعتين» are the same word in two cases, and the first version of this check listed
 * only the second — which is how the four customer strings survived the first pass. Both forms are
 * listed here, and a duration that has to appear in prose goes through an ICU `plural` message,
 * which is what the exclusion below allows for.
 */
const DUAL_DURATIONS = /ساعت(?:ان|ين)|دقيقت(?:ان|ين)|يوم(?:ان|ين)/;

describe('no duration is written as a dual word', () => {
  it.each(CATALOGUES.filter((f) => f.includes('/ar')))('%s', (file) => {
    const found = literals(readFileSync(file, 'utf8'), file)
      /* An ICU message spells every plural form on purpose — that IS the remedy. */
      .filter(({ text }) => !text.includes('plural'))
      .filter(({ text }) => DUAL_DURATIONS.test(text))
      .map(({ line, text }) => `${file}:${line}  «${text.slice(0, 90)}»`);

    expect(
      found,
      'A duration written as «ساعتان» is right at one setting value and wrong at every other. ' +
        'Take {window} and fill it with an ICU duration message — `durationParts` from ' +
        '`@safra/contracts` picks the unit, the catalogue knows the six Arabic plural forms.',
    ).toEqual([]);
  });
});
