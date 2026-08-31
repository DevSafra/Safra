import { describe, expect, it } from 'vitest';

import { t } from './strings';
import {
  editableText,
  isEditableSchema,
  matchesFilter,
  ratePercentEcho,
  settingDisplay,
  unitOf,
  type DisplayableSetting,
} from './settings-display';

/**
 * How الإعدادات reads a value (§9.3, P-005).
 *
 * ## What these are protecting
 *
 * The screen printed the stored JSON and nothing else, so four of the seventeen rows could not be
 * read without knowing the schema by heart — `0.07`, `120`, `17`, `10`. Two of them were money
 * with no currency anywhere on the row, which is the standing rule of 2026-08-25 broken in the
 * console rather than in a template.
 *
 * Every case below was watched to FAIL against the code it describes before being kept: the money
 * cases against `String(value)`, the plural cases against a hardcoded «دقيقة», the isolation case
 * against a `text` that joined the number and the unit into one string.
 */
const ARABIC = /[ؠ-ي]/;

const setting = (over: Partial<DisplayableSetting>): DisplayableSetting => ({
  key: 'test.example',
  value: 1,
  valueSchema: 'positiveInt',
  ...over,
});

describe('a rate', () => {
  it('reads as the percentage it means, with the fraction it is stored as', () => {
    const display = settingDisplay(
      setting({ key: 'commission.partner_rate', value: 0.07, valueSchema: 'rate' }),
      true,
    );

    expect(display).toMatchObject({ kind: 'quantity' });
    expect(display.kind === 'quantity' && display.text).toBe(`7${t.percentSign}`);
    /* The fraction survives, because it is what the field and the audit row hold. */
    expect(display.kind === 'quantity' && display.aside).toContain('0.07');
  });

  /**
   * NOT rounded to one decimal.
   *
   * `percent()` in `format.ts` rounds, which is right for a dashboard metric and wrong here: a
   * setting shown as «٧٫٣٪» beside a field holding `0.0725` disagrees with itself.
   */
  it('keeps every decimal a rate actually has', () => {
    const display = settingDisplay(setting({ value: 0.0725, valueSchema: 'rate' }), true);

    expect(display.kind === 'quantity' && display.text).toBe(`7.25${t.percentSign}`);
  });

  it('echoes the percentage while the fraction is being typed', () => {
    expect(ratePercentEcho('0.07')).toContain(`7${t.percentSign}`);
    /* The mistake it exists for: a factor of ten, visible before it is saved. */
    expect(ratePercentEcho('0.7')).toContain(`70${t.percentSign}`);
    expect(ratePercentEcho('')).toBeNull();
    expect(ratePercentEcho('abc')).toBeNull();
  });
});

describe('a percentage and an hour', () => {
  it('writes a percent schema with its sign', () => {
    const display = settingDisplay(
      setting({ key: 'refund.minimum_percent', value: 50, valueSchema: 'percent' }),
      true,
    );

    expect(display.kind === 'quantity' && display.text).toBe(`50${t.percentSign}`);
  });

  it('writes an hour of the day as a time, and says which clock', () => {
    const display = settingDisplay(
      setting({
        key: 'booking.same_day_cutoff_hour',
        value: 17,
        valueSchema: 'hourOfDay',
      }),
      true,
    );

    expect(display.kind === 'quantity' && display.text).toBe('17:00');
    expect(display.kind === 'quantity' && display.aside).toBe(
      t.sections.settings.cityTime,
    );
  });

  it('pads a morning hour, so 9 is not read as 90', () => {
    const display = settingDisplay(setting({ value: 9, valueSchema: 'hourOfDay' }), true);

    expect(display.kind === 'quantity' && display.text).toBe('09:00');
  });
});

describe('a count with a unit', () => {
  /**
   * The unit comes from the key SUFFIX, for `positiveInt` only.
   *
   * `booking.confirmation_window_minutes` and `search.max_nights` are both `positiveInt`, so the
   * schema cannot say. An unknown key gets NO unit rather than a guessed one — a missing unit
   * costs a reader something they can infer from the label, a wrong one states a falsehood.
   */
  it('takes the unit from the key, and takes none where the key does not say', () => {
    expect(unitOf('booking.confirmation_window_minutes', 'positiveInt')).toBe('minutes');
    expect(unitOf('booking.pending_payment_timeout_minutes', 'positiveInt')).toBe(
      'minutes',
    );
    expect(unitOf('search.max_nights', 'positiveInt')).toBe('nights');
    expect(unitOf('test.settings_admin_fixture', 'positiveInt')).toBeNull();
    /* A schema that carries its own unit must not also pick one up from its key. */
    expect(unitOf('booking.same_day_cutoff_hour', 'hourOfDay')).toBeNull();
  });

  /**
   * Arabic agreement across the categories that differ, asserted through the rendered word.
   *
   * The boundaries are not where an English speaker expects them: 2 is the dual, 3–10 takes the
   * broken plural, and **11–99 takes the SINGULAR**. A message with only `one`/`other` renders
   * «١٢٠ دقائق», which is the form a real SLA value lands on most often.
   */
  it.each([
    [1, 'دقيقة'],
    [2, 'دقيقتان'],
    [5, 'دقائق'],
    [30, 'دقيقة'],
    [120, 'دقيقة'],
  ])('inflects the noun for %i minutes', (value, expected) => {
    const display = settingDisplay(
      setting({
        key: 'booking.confirmation_window_minutes',
        value,
        valueSchema: 'positiveInt',
      }),
      true,
    );

    expect(display.kind === 'quantity' && display.unit).toBe(expected);
  });

  it('counts nights the same way', () => {
    const display = settingDisplay(
      setting({ key: 'search.max_nights', value: 90, valueSchema: 'positiveInt' }),
      true,
    );

    expect(display.kind === 'quantity' && display.text).toBe('90');
    expect(display.kind === 'quantity' && display.unit).toBe('ليلة');
  });

  /**
   * The figure and the noun stay APART, and this is the assertion that keeps them apart.
   *
   * «120 دقيقة» built as one string and set in a right-to-left line renders as «دقيقة 120»: the
   * digits are a left-to-right run inside an RTL paragraph, so the two swap places. The row draws
   * the figure as its own isolated run; a `text` that had absorbed the Arabic word would defeat
   * that silently, and no string assertion elsewhere would notice.
   */
  it('never joins the figure and the Arabic unit into one run', () => {
    const display = settingDisplay(
      setting({
        key: 'booking.confirmation_window_minutes',
        value: 120,
        valueSchema: 'positiveInt',
      }),
      true,
    );

    expect(display.kind === 'quantity' && display.text).toBe('120');
    expect(display.kind === 'quantity' && ARABIC.test(display.text)).toBe(false);
  });

  it('shows a bare number for a key with no unit, rather than inventing one', () => {
    const display = settingDisplay(
      setting({ key: 'test.settings_admin_fixture', value: 120 }),
      true,
    );

    expect(display.kind === 'quantity' && display.text).toBe('120');
    expect(display.kind === 'quantity' && display.unit).toBeNull();
  });
});

describe('money', () => {
  /**
   * No amount without its currency — Bashar's standing rule of 2026-08-25.
   *
   * This is the case the old screen got wrong: `partner.first_violation_fine` rendered «10» and
   * SYP and USD differ by four orders of magnitude, so the figure was not a rough answer — it was
   * a number nobody could act on.
   */
  it('writes a bare number as an amount in the platform currency', () => {
    const display = settingDisplay(
      setting({ key: 'partner.first_violation_fine', value: 10, valueSchema: 'money' }),
      true,
    );

    expect(display).toMatchObject({ kind: 'money' });
    expect(display.kind === 'money' && display.text).toBe('$10.00');
  });

  it('keeps the currency a row states, rather than repainting it as dollars', () => {
    const display = settingDisplay(
      setting({ value: { amount: '8.50', currency: 'JOD' }, valueSchema: 'money' }),
      true,
    );

    /* Three decimals: JOD is a three-decimal currency, per `@safra/contracts`. */
    expect(display.kind === 'money' && display.text).toContain('8.500');
    expect(display.kind === 'money' && display.text).not.toContain('$');
  });

  /**
   * `money.always_usd` relabels without converting, so the row must SAY so.
   *
   * Otherwise «٨٫٥٠٠ د.أ» on screen is spent as eight dollars fifty and the console has told the
   * reader something untrue while displaying the stored value faithfully.
   */
  it('warns when the platform reads a non-dollar row as dollars', () => {
    const jod = { value: { amount: '8.50', currency: 'JOD' }, valueSchema: 'money' };

    expect(settingDisplay(setting(jod), true)).toMatchObject({
      note: t.sections.settings.alwaysUsdNote,
    });
    /* Off — the row means what it says, so there is nothing to warn about. */
    expect(settingDisplay(setting(jod), false)).toMatchObject({ note: null });
  });

  it('says nothing about the override on a row that is already in dollars', () => {
    const display = settingDisplay(setting({ value: 10, valueSchema: 'money' }), true);

    expect(display.kind === 'money' && display.note).toBeNull();
  });

  it('edits the amount alone, never the shape around it', () => {
    expect(
      editableText({
        key: 'k',
        valueSchema: 'money',
        value: { amount: '8.50', currency: 'JOD' },
      }),
    ).toBe('8.50');
    expect(editableText({ key: 'k', valueSchema: 'money', value: 1.99 })).toBe('1.99');
  });

  it('refuses a shape it cannot read rather than printing a number in an unknown currency', () => {
    expect(settingDisplay(setting({ value: {}, valueSchema: 'money' }), true)).toEqual({
      kind: 'missing',
    });
    expect(
      settingDisplay(setting({ value: { amount: 'abc' }, valueSchema: 'money' }), true),
    ).toEqual({ kind: 'missing' });
  });
});

describe('the other schemas', () => {
  it('reads a flag as a flag', () => {
    expect(
      settingDisplay(setting({ value: true, valueSchema: 'boolean' }), true),
    ).toEqual({ kind: 'flag', on: true });
    expect(
      settingDisplay(setting({ value: false, valueSchema: 'boolean' }), true),
    ).toEqual({ kind: 'flag', on: false });
  });

  it('names a fee mode and a sanctions policy in the reader’s words', () => {
    expect(
      settingDisplay(setting({ value: 'flat', valueSchema: 'feeMode' }), true),
    ).toEqual({ kind: 'choice', text: t.sections.settings.feeFlat });

    expect(
      settingDisplay(
        setting({ value: 'advisory', valueSchema: 'sanctionsPolicy' }),
        true,
      ),
    ).toEqual({ kind: 'choice', text: t.sections.settings.sanctionsPolicy.advisory });
  });

  /**
   * A policy value with no entry falls back to the CODE, not to a prettified version of it.
   *
   * `a-missing-translation-must-look-like-one`: a fourth policy added to the contract and not to
   * the catalogue has to look like a missing translation rather than like a label somebody chose.
   */
  it('falls back to the raw value for a choice nobody has translated', () => {
    expect(
      settingDisplay(setting({ value: 'lenient', valueSchema: 'sanctionsPolicy' }), true),
    ).toEqual({ kind: 'choice', text: 'lenient' });
  });

  it('pretty-prints a routing table instead of putting it on one line', () => {
    const display = settingDisplay(
      setting({
        key: 'payment.provider_routing',
        value: { SY: ['manual_transfer'] },
        valueSchema: 'json',
      }),
      true,
    );

    expect(display.kind === 'json' && display.text).toContain('\n');
    expect(display.kind === 'json' && display.text).toContain('manual_transfer');
  });

  it('reads a string as a string', () => {
    expect(
      settingDisplay(
        setting({ value: 'Safra Technologies GmbH', valueSchema: 'string' }),
        true,
      ),
    ).toEqual({ kind: 'text', text: 'Safra Technologies GmbH' });
  });

  it('marks the schemas the form cannot validate as read-only', () => {
    expect(isEditableSchema('rate')).toBe(true);
    expect(isEditableSchema('money')).toBe(true);
    expect(isEditableSchema('json')).toBe(false);
    expect(isEditableSchema('string')).toBe(false);
  });
});

describe('the filter', () => {
  const commission = {
    key: 'commission.partner_rate',
    descriptionAr: 'عمولة الشريك — تخصم من مستحقاته قبل التحويل',
  };

  it('finds a setting by its key and by its Arabic label', () => {
    expect(matchesFilter(commission, 'commission')).toBe(true);
    expect(matchesFilter(commission, 'partner_rate')).toBe(true);
    expect(matchesFilter(commission, 'عمولة')).toBe(true);
  });

  it('is case-insensitive, because a key is read off a runbook', () => {
    expect(matchesFilter(commission, 'COMMISSION')).toBe(true);
  });

  /**
   * Arabic folded to one spelling.
   *
   * «عموله» for «عمولة» and «الاعداد» for «الإعداد» are the same word typed by somebody whose
   * keyboard habit drops the hamza or the taa marbuta. That is not a mistake the reader can see,
   * so it must not be a miss.
   */
  it('folds hamza, taa marbuta and diacritics', () => {
    expect(matchesFilter(commission, 'عموله')).toBe(true);
    expect(
      matchesFilter({ key: 'k', descriptionAr: 'إلزامية فحص العقوبات' }, 'الزامية'),
    ).toBe(true);
    expect(matchesFilter({ key: 'k', descriptionAr: 'المخزَّن' }, 'المخزن')).toBe(true);
  });

  it('matches everything on an empty query and nothing on a miss', () => {
    expect(matchesFilter(commission, '')).toBe(true);
    expect(matchesFilter(commission, '   ')).toBe(true);
    expect(matchesFilter(commission, 'zzzz')).toBe(false);
  });

  it('does not fall over on a row with no Arabic label', () => {
    expect(
      matchesFilter({ key: 'test.owned_by_pid_1', descriptionAr: null }, 'owned'),
    ).toBe(true);
    expect(
      matchesFilter({ key: 'test.owned_by_pid_1', descriptionAr: null }, 'عمولة'),
    ).toBe(false);
  });
});
