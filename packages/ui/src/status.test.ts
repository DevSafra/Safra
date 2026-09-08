import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { statusTone, VOCABULARIES, type Tone } from './status.js';

/**
 * The two rules a status colour has to satisfy at once (Bashar, 2026-08-06):
 *
 *  1. a status is the same colour on every screen, and
 *  2. no two statuses on ONE screen share a colour.
 *
 * Rule 1 is what the map being global gives you for free. Rule 2 is a CONSTRAINT ACROSS the map
 * that nobody can verify by reading it — thirteen payment statuses have to be thirteen colours,
 * and the person adding a fourteenth will not notice. So it is checked here, per vocabulary,
 * against the lists the map ships with.
 */
describe('no two statuses on one screen share a colour', () => {
  it.each(Object.keys(VOCABULARIES))('%s', (name) => {
    const values = VOCABULARIES[name] ?? [];
    const byTone = new Map<Tone, string[]>();

    for (const value of values) {
      const tone = statusTone(value);

      byTone.set(tone, [...(byTone.get(tone) ?? []), value]);
    }

    const clashes = [...byTone.entries()]
      .filter(([, statuses]) => statuses.length > 1)
      .map(([tone, statuses]) => `${tone}: ${statuses.join(', ')}`);

    expect(clashes).toStrictEqual([]);
  });

  /** A vocabulary that lost its values would pass the check above while proving nothing. */
  it('checks every vocabulary the project defines', () => {
    expect(Object.keys(VOCABULARIES).length).toBeGreaterThanOrEqual(11);

    for (const [name, values] of Object.entries(VOCABULARIES)) {
      expect(values.length, name).toBeGreaterThanOrEqual(3);
    }
  });

  /**
   * Every status in every vocabulary is actually IN the map.
   *
   * `statusTone` falls back to `faint` for an unknown value, which is the right behaviour at
   * runtime and would quietly satisfy the clash check for a vocabulary of one unmapped status.
   */
  it('has a colour for every status, not a fallback', () => {
    const unmapped: string[] = [];

    for (const [name, values] of Object.entries(VOCABULARIES)) {
      for (const value of values) {
        // `draft`, `refunded` and `used` are legitimately faint; they are mapped to it.
        if (
          statusTone(value) === 'faint' &&
          !['draft', 'refunded', 'used'].includes(value)
        ) {
          unmapped.push(`${name}.${value}`);
        }
      }
    }

    expect(unmapped).toStrictEqual([]);
  });
});

describe('statusTone', () => {
  /**
   * Purple, never gold — SRS §1 and §14 make this an explicit rule, and it is the one a
   * simplification keeps trying to undo. A paid booking waiting on a partner is not good news.
   */
  it('keeps pending_confirmation purple', () => {
    expect(statusTone('pending_confirmation')).toBe('pend');
    expect(statusTone('pending_confirmation')).not.toBe('gold');
  });

  /**
   * The distinctions that were lost when everything was collapsed onto seven tones, and that
   * Bashar asked for back. Each pair shares a screen, so each pair must differ.
   */
  it.each([
    ['confirmed', 'completed'],
    ['approved', 'published'],
    ['cancelled', 'disputed'],
    ['rejected', 'suspended'],
    ['draft', 'archived'],
    ['expired', 'failed'],
    ['captured', 'collected'],
    ['refunded', 'partially_refunded'],
    ['pending', 'processing'],
    ['superseded', 'terminated'],
  ])('tells %s apart from %s', (a, b) => {
    expect(statusTone(a)).not.toBe(statusTone(b));
  });

  it('gives an unknown status no signal at all', () => {
    expect(statusTone('some_future_status')).toBe('faint');
    expect(statusTone('')).toBe('faint');
    expect(statusTone(null)).toBe('faint');
    expect(statusTone(undefined)).toBe('faint');
  });

  /** Inherited object properties are not statuses — see the note on the lookup. */
  it.each([['constructor'], ['__proto__'], ['toString'], ['hasOwnProperty']])(
    'does not treat %s as a status',
    (key) => {
      expect(statusTone(key)).toBe('faint');
    },
  );
});

/**
 * A pill's text is its STATUS, and nothing else goes in it.
 *
 * «المستحقات مجمّدة · $181.35» — one status with the frozen amount appended, added for finding 209
 * so an operator could confirm a figure a partner was reading down the phone. It broke the status
 * system in two ways at once. A pill's width is supposed to be its word, so a figure stretched the
 * chip; and a pill's TEXT is how every check identifies the status, so three disputes with three
 * amounts read as **three different statuses sharing one colour** — which is the thing
 * «no two statuses on one screen share a colour» exists to forbid.
 *
 * `e2e/navigation.spec.ts` does catch it, and did. But only once the database happened to hold two
 * frozen disputes with different amounts: with a single one the pill text is unique and the run is
 * green. A rule that holds only on a lucky fixture is the shape of defect this file exists to make
 * deterministic, so the source is swept as well.
 *
 * An amount belongs BESIDE the pill, which is what every other screen already did — the customer
 * record's booking line has had `<StatusPill>` and a separate `<Ltr>` amount all along.
 */
describe('a status pill carries only its status', () => {
  const ROOT = new URL('../../../', import.meta.url).pathname;
  const APPS = ['apps/admin/src', 'apps/web/src', 'apps/partner/src', 'packages/ui/src'];

  function sources(dir: string): string[] {
    const out: string[] = [];

    for (const entry of readdirSync(join(ROOT, dir))) {
      const relative = `${dir}/${entry}`;

      if (statSync(join(ROOT, relative)).isDirectory()) {
        out.push(...sources(relative));
      } else if (entry.endsWith('.tsx')) {
        out.push(relative);
      }
    }

    return out;
  }

  it('never renders money inside one', () => {
    const inside: string[] = [];

    for (const app of APPS) {
      for (const file of sources(app)) {
        const body = readFileSync(join(ROOT, file), 'utf8').replace(
          /\/\*[\s\S]*?\*\//g,
          ' ',
        );

        /* Every `<StatusPill …>` up to its closing tag, which is the text a reader sees. */
        for (const [whole] of body.matchAll(/<StatusPill[\s\S]*?<\/StatusPill>/g)) {
          if (/(?<![\w.])(amount|money)\s*\(/.test(whole)) {
            inside.push(`${file}: ${whole.replace(/\s+/g, ' ').slice(0, 96)}`);
          }
        }
      }
    }

    expect(
      inside,
      'an amount inside a status pill makes one status read as one per value',
    ).toEqual([]);
  });

  /*
    The control: a sweep that found no pills at all would pass while proving nothing, and this one
    is a regex over JSX — the easiest kind to write inert.
  */
  it('reads the pills it is meant to be checking', () => {
    let pills = 0;

    for (const app of APPS) {
      for (const file of sources(app)) {
        const body = readFileSync(join(ROOT, file), 'utf8').replace(
          /\/\*[\s\S]*?\*\//g,
          ' ',
        );

        pills += [...body.matchAll(/<StatusPill[\s\S]*?<\/StatusPill>/g)].length;
      }
    }

    expect(
      pills,
      'the sweep matched no status pills, so it is reading nothing',
    ).toBeGreaterThan(10);
  });
});

/**
 * A status WORD is never painted by a hand-written condition.
 *
 * The customer's النزاعات list chose its pill colour with three branches — `resolved` green,
 * `rejected` in `faint`, everything else amber — and two of them disagreed with the rest of the
 * platform. `statusTone` gives `open` **crimson**, which read as amber, and `rejected` **bad**,
 * which read as `faint`: the tone this rule reserves for a status nobody has mapped. So a dispute
 * decided in the host's favour was red on the console and grey to the guest whose complaint it was,
 * under a correct Arabic word — «محسوم لصالح الشريك» — that the colour then contradicted.
 *
 * `e2e/navigation.spec.ts` holds «one status, one colour» across the console's twenty sections and
 * **cannot see the other two apps**, which is how three branches drifted there unnoticed. This is
 * the half of that rule a unit test can hold: the SOURCE shape, in every app.
 *
 * The floor is a status label rendered in the same expression as a hand-written tone class. A
 * colour assembled far from its label walks past, the same way it walks past the browser sweep.
 */
describe('a status word is coloured by statusTone, never by a condition', () => {
  const ROOT2 = new URL('../../../', import.meta.url).pathname;
  const APPS2 = ['apps/admin/src', 'apps/web/src', 'apps/partner/src'];

  function tsx(dir: string): string[] {
    const out: string[] = [];

    for (const entry of readdirSync(join(ROOT2, dir))) {
      const relative = `${dir}/${entry}`;

      if (statSync(join(ROOT2, relative)).isDirectory()) {
        out.push(...tsx(relative));
      } else if (entry.endsWith('.tsx')) {
        out.push(relative);
      }
    }

    return out;
  }

  /** The words that RESOLVE a status value to its label, in any of the three apps. */
  const LABELLERS = /\b(localStatus|statusWord|bookingStatus|customerBookingStatus)\s*\(/;
  const TONE_CLASS =
    /\b(?:border|bg|text)-(?:ok|bad|warn|pend|teal|orange|crimson|sky|indigo|lime|slate|stone|faint)\b/;

  it('never picks a tone class beside the label it paints', () => {
    const painted: string[] = [];

    for (const app of APPS2) {
      for (const file of tsx(app)) {
        const body = readFileSync(join(ROOT2, file), 'utf8').replace(
          /\/\*[\s\S]*?\*\//g,
          ' ',
        );

        /* One JSX element at a time: `<span … >` up to its closing bracket, plus its children. */
        for (const [whole] of body.matchAll(
          /<(?:span|p|div|em|strong)\b[^>]*>[\s\S]{0,400}?<\/(?:span|p|div|em|strong)>/g,
        )) {
          if (!LABELLERS.test(whole)) continue;
          if (!TONE_CLASS.test(whole)) continue;
          if (!/\?/.test(whole)) continue;

          painted.push(`${file}: ${whole.replace(/\s+/g, ' ').slice(0, 110)}`);
        }
      }
    }

    expect(
      painted.sort(),
      'these paint a status word with a hand-written condition',
    ).toEqual([]);
  });

  /*
    The control. This is a regex over JSX and would pass on an empty read, so it asserts that it
    FOUND status labels to check in the first place.
  */
  it('reads the status labels it is meant to be checking', () => {
    let labels = 0;

    for (const app of APPS2) {
      for (const file of tsx(app)) {
        const body = readFileSync(join(ROOT2, file), 'utf8').replace(
          /\/\*[\s\S]*?\*\//g,
          ' ',
        );

        labels += [...body.matchAll(new RegExp(LABELLERS.source, 'g'))].length;
      }
    }

    /*
      `label(t.enums.…)` is the console's resolver and `localStatus` / `customerBookingStatus` the
      customer's — 107 calls between them at the time of writing. Twenty is a floor a real
      regression in this sweep would fall through and ordinary churn would not.
    */
    expect(
      labels,
      'the sweep found no status labels at all, so it is reading nothing',
    ).toBeGreaterThan(20);
  });
});
