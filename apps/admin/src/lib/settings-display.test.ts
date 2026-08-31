import { describe, expect, it } from 'vitest';

import { t } from './strings';
import {
  editableText,
  historyChange,
  isEditableSchema,
  matchesFilter,
  ratePercentEcho,
  routingRows,
  settingDisplay,
  settingHistorySchema,
  settingName,
  unitOf,
  valueTypeName,
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

  /**
   * A nested object with no reader is still SHOWN, pretty-printed.
   *
   * Hiding a setting is worse than an ugly one — the setting still governs the platform. The
   * routing table has a reader now (see «the payment routing table» below); this is what happens
   * to the next `json` setting, before anybody has written one for it.
   */
  it('pretty-prints an object it has no reader for, instead of one long line', () => {
    const display = settingDisplay(
      setting({
        key: 'search.facet_weights',
        value: { city: 2, price: 1 },
        valueSchema: 'json',
      }),
      true,
    );

    expect(display.kind === 'json' && display.text).toContain('\n');
    expect(display.kind === 'json' && display.text).toContain('city');
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

describe('the name a reader sees', () => {
  /**
   * The CATALOGUE wins over the database column.
   *
   * `settings.description_ar` is one column and therefore one language: using it as the label put
   * the console's own words somewhere the task of adding a language cannot reach. Two of them were
   * already wrong — «مهلة Pending Payment» carried an English status name, and «مهلة تأكيد الشريك
   * (ساعتان)» stated the current VALUE, which stops being true when somebody sets 180 minutes.
   */
  it('takes the name from the catalogue, not from the database description', () => {
    expect(
      settingName({
        key: 'booking.pending_payment_timeout_minutes',
        descriptionAr: 'مهلة Pending Payment — يلغى الحجز تلقائياً إن لم يكتمل الدفع',
      }),
    ).toBe(t.sections.settings.names['booking.pending_payment_timeout_minutes']);

    /* And the catalogue entry carries no English. */
    expect(
      settingName({
        key: 'booking.pending_payment_timeout_minutes',
        descriptionAr: null,
      }),
    ).not.toMatch(/[A-Za-z]/);
  });

  it('falls back to the database description, then to the key', () => {
    expect(
      settingName({ key: 'not.in.catalogue', descriptionAr: 'وصف من قاعدة البيانات' }),
    ).toBe('وصف من قاعدة البيانات');
    /* Neither — so the KEY, which is what a missing translation should look like. */
    expect(settingName({ key: 'not.in.catalogue', descriptionAr: null })).toBe(
      'not.in.catalogue',
    );
  });

  it('names every seeded setting, so no row falls back to a Latin key', () => {
    /*
      The fifteen keys `packages/db/src/seed/reference.ts` creates. Written out rather than imported
      because `@safra/db` is not a dependency of the console — and because a list somebody has to
      edit is the point: a setting seeded without a name here reads as its key on an Arabic screen.
    */
    const seeded = [
      'commission.customer_fee_mode',
      'commission.customer_fee_value',
      'commission.partner_rate',
      'booking.confirmation_window_minutes',
      'booking.same_day_cutoff_hour',
      'booking.pending_payment_timeout_minutes',
      'partner.first_violation_fine',
      'wallet.sla_compensation',
      'money.always_usd',
      'rbac.finance_can_manage_fx',
      'compliance.sanctions_screening',
      'refund.minimum_percent',
      'payment.provider_routing',
      'payment.merchant_of_record',
      'search.max_nights',
    ];

    for (const key of seeded) {
      const name = settingName({ key, descriptionAr: null });

      expect(name, `${key} has no Arabic name`).not.toBe(key);
      expect(name, `${key} carries Latin text`).not.toMatch(/[A-Za-z]/);
    }
  });
});

describe('the kind of value, in Arabic', () => {
  it('names the two types that reach the screen read-only', () => {
    expect(valueTypeName('json')).toBe(t.sections.settings.valueTypes['json']);
    expect(valueTypeName('string')).toBe(t.sections.settings.valueTypes['string']);
    expect(valueTypeName('json')).not.toMatch(/[A-Za-z]/);
  });

  /** A schema nobody has named reads as its own name — a missing translation, looking like one. */
  it('falls back to the schema name itself', () => {
    expect(valueTypeName('zonedInterval')).toBe('zonedInterval');
  });
});

describe('the payment routing table', () => {
  const ROUTING = 'payment.provider_routing';

  it('reads country and provider in the reader’s language', () => {
    const rows = routingRows(ROUTING, {
      SY: ['manual_transfer'],
      '*': ['manual_transfer'],
    });

    expect(rows).not.toBeNull();
    expect(rows?.[0]?.place).toBe('سوريا');
    expect(rows?.[0]?.providers).toEqual([
      t.sections.settings.providers['manual_transfer'],
    ]);
    /* Nothing Latin survives — that was the whole complaint about the JSON block. */
    expect(rows?.flatMap((row) => [row.place, ...row.providers]).join(' ')).not.toMatch(
      /[A-Za-z]/,
    );
  });

  /**
   * The `*` row sorts LAST, whatever order the object happens to be in.
   *
   * Key order in JSON is arbitrary, and «كل البلدان الأخرى» printed above «سوريا» reads as though
   * the general case wins — the opposite of how `provider.registry` resolves it.
   */
  it('puts the fallback last and marks it as the fallback', () => {
    const rows = routingRows(ROUTING, {
      '*': ['manual_transfer'],
      SY: ['manual_transfer'],
    });

    expect(rows?.map((row) => row.isFallback)).toEqual([false, true]);
    expect(rows?.[1]?.place).toBe(t.sections.settings.routingFallback);
  });

  it('shows a provider nobody has named as its slug', () => {
    const rows = routingRows(ROUTING, { SY: ['stripe_cards'] });

    expect(rows?.[0]?.providers).toEqual(['stripe_cards']);
  });

  /**
   * It speaks only for the key it understands.
   *
   * `Record<string, string[]>` is a shape other settings may take, and reading an unrelated one as
   * «country → payment provider» would put confident nonsense on the screen. Anything else falls
   * through to the JSON block, which is honest about not knowing.
   */
  it('refuses a different key with the same shape', () => {
    expect(routingRows('search.facets', { SY: ['manual_transfer'] })).toBeNull();
  });

  it('refuses a shape it cannot read, rather than half-rendering it', () => {
    expect(routingRows(ROUTING, { SY: 'manual_transfer' })).toBeNull();
    expect(routingRows(ROUTING, { SY: ['manual_transfer'], JO: [7] })).toBeNull();
    expect(routingRows(ROUTING, {})).toBeNull();
    expect(routingRows(ROUTING, ['manual_transfer'])).toBeNull();
    expect(routingRows(ROUTING, null)).toBeNull();
  });

  it('renders as rows through settingDisplay, not as JSON', () => {
    const display = settingDisplay(
      setting({
        key: ROUTING,
        value: { SY: ['manual_transfer'] },
        valueSchema: 'json',
      }),
      true,
    );

    expect(display.kind).toBe('routing');
  });

  /** An unreadable `json` value still appears — hiding a setting is worse than an ugly one. */
  it('falls back to pretty-printed JSON for a value it cannot read', () => {
    const display = settingDisplay(
      setting({ key: ROUTING, value: { SY: 7 }, valueSchema: 'json' }),
      true,
    );

    expect(display.kind).toBe('json');
  });
});

describe('the change history', () => {
  const entry = (previousValue: unknown, newValue: unknown) => ({
    previousValue,
    newValue,
    reason: null,
    changedByEmail: 'ops@safra.test',
    createdAt: '2026-08-31T10:00:00.000Z',
  });

  /**
   * A change log is a payload a person reads, so the money rule applies to it.
   *
   * «من 10 إلى 12» about a fine is the same defect as a bare amount on the row above it — and it is
   * the defect `strings.test.ts` holds `timeline_events.payload` and `audit_log.after` to.
   */
  it('carries the currency on both sides of a money change', () => {
    const line = historyChange(
      entry(10, 12),
      setting({ key: 'partner.first_violation_fine', valueSchema: 'money' }),
      true,
    );

    expect(line).toContain('$10.00');
    expect(line).toContain('$12.00');
  });

  it('reads a rate change as the percentages it means', () => {
    const line = historyChange(
      entry(0.07, 0.08),
      setting({ key: 'commission.partner_rate', valueSchema: 'rate' }),
      true,
    );

    expect(line).toContain(`7${t.percentSign}`);
    expect(line).toContain(`8${t.percentSign}`);
  });

  /**
   * The isolate goes round the FIGURE, never round the whole value.
   *
   * `ltrIsolate('90 ليلة')` renders «ليلة 90»: the string is laid out left to right, so the Arabic
   * noun lands on the wrong side of the digits. The drawer read «من ليلة 89 إلى ليلة 90» until this
   * was split — the same swap the row itself was fixed for, one component further in.
   *
   * Asserted on the CONTROL CHARACTERS, because that is the difference. `U+2066 … U+2069` must
   * contain the digits and nothing else.
   */
  it('isolates the figure alone, not the figure with its Arabic unit', () => {
    const line = historyChange(
      entry(89, 90),
      setting({ key: 'search.max_nights', valueSchema: 'positiveInt' }),
      true,
    );

    expect(line).toContain('\u2066' + '89' + '\u2069');
    expect(line).toContain('\u2066' + '90' + '\u2069');
    /* And the unit is outside it, as ordinary Arabic. */
    expect(line).not.toContain('\u2066' + '90 ');
  });

  it('reads a duration change with its unit, and a flag as words', () => {
    expect(
      historyChange(
        entry(120, 180),
        setting({
          key: 'booking.confirmation_window_minutes',
          valueSchema: 'positiveInt',
        }),
        true,
      ),
    ).toContain('دقيقة');

    expect(
      historyChange(
        entry(true, false),
        setting({ key: 'money.always_usd', valueSchema: 'boolean' }),
        true,
      ),
    ).toContain(t.sections.settings.disabled);
  });

  /** The FIRST change has no previous value — the row was created, not edited. */
  it('says «لا بيانات» rather than «undefined» for a first change', () => {
    const line = historyChange(
      entry(null, 90),
      setting({ key: 'search.max_nights', valueSchema: 'positiveInt' }),
      true,
    );

    expect(line).toContain(t.admin.noData);
    expect(line).not.toContain('null');
  });

  /**
   * Parsed at the boundary, not cast.
   *
   * The two values are `unknown` by design, so nothing downstream would notice a payload that had
   * lost its shape — the failure would surface as «[object Object]» inside a change log.
   */
  it('rejects a history payload that has lost its shape', () => {
    expect(settingHistorySchema.safeParse({ history: [] }).success).toBe(true);
    expect(settingHistorySchema.safeParse({}).success).toBe(false);
    expect(
      settingHistorySchema.safeParse({ history: [{ newValue: 1, reason: null }] })
        .success,
    ).toBe(false);
    expect(
      settingHistorySchema.safeParse({
        history: [
          {
            previousValue: 1,
            newValue: 2,
            reason: null,
            changedByEmail: null,
            createdAt: '2026-08-31',
          },
        ],
      }).success,
    ).toBe(true);
  });
});
