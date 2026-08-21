'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { SANCTIONS_POLICIES } from '@safra/contracts';

import type { EditableSetting } from '@/lib/api';
import { fill, t } from '@/lib/strings';
import { shortDate } from '@/lib/format';

/** Schemas this form knows how to render an input for. */
const EDITABLE = new Set([
  'rate',
  'percent',
  'positiveInt',
  'hourOfDay',
  'money',
  'boolean',
  'feeMode',
  'sanctionsPolicy',
]);

/**
 * One setting, with its own save (§9.3, P-005).
 *
 * Per row rather than one form for the page. A bulk save turns somebody else's
 * concurrent edit into a silent revert, and it makes the audit trail read as though
 * one person changed everything at once — which is precisely the question the trail
 * exists to answer correctly.
 *
 * The input is chosen from the setting's declared `valueSchema`, so a rate gets a
 * decimal field and a toggle gets a checkbox. Anything this form cannot validate is
 * shown read-only with the reason — `payment.provider_routing` is the live example:
 * a nested object where a typo would break payment routing.
 */
export function SettingRow({ setting }: { setting: EditableSetting }) {
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editable = EDITABLE.has(setting.valueSchema);

  async function save(value: unknown, reason: string) {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/settings/${encodeURIComponent(setting.key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setError(messageOf(body) ?? t.sections.settings.saveFailed);
        setBusy(false);
        return;
      }

      setEditing(false);
      router.refresh();
      setBusy(false);
    } catch {
      setError(t.errors.unreachable);
      setBusy(false);
    }
  }

  return (
    <div>
      {/*
        The design's field treatment: 11.5px label, the value at 13.5px, a unit suffix beside it
        and a 10.5px hint below. The Arabic DESCRIPTION is the label, not the key — somebody
        adjusting the commission is thinking about money, not about `commission.partner_rate`.
        The key is still shown, small, because it is what an audit entry and a runbook name.
      */}
      <div className="flex flex-wrap items-start gap-2">
        <label className="text-[11.5px] font-semibold text-muted">
          {setting.descriptionAr ?? setting.key}
        </label>

        {editable && !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ms-auto cursor-pointer rounded-md border border-line px-2.5 py-0.5 text-[10.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.5)] hover:text-gold"
          >
            {t.sections.settings.change}
          </button>
        ) : null}
      </div>

      {!editing ? (
        <p className="mt-1.5 text-[13.5px] font-bold text-text" dir="ltr">
          {display(setting.value)}
        </p>
      ) : null}

      <p className="mt-1 font-mono text-[10px] text-faint2" dir="ltr">
        {setting.key}
      </p>

      {setting.updatedByEmail ? (
        <p className="mt-1 text-[10.5px] text-faint">
          {fill(t.sections.settings.lastChanged, {
            who: setting.updatedByEmail,
            when: shortDate(setting.updatedAt),
          })}
        </p>
      ) : null}

      {!editable ? (
        <p className="mt-2 rounded border border-line bg-field px-2.5 py-2 text-[10.5px] leading-relaxed text-faint">
          {fill(t.sections.settings.notEditable, { schema: setting.valueSchema })}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-[11.5px] text-bad">
          {error}
        </p>
      ) : null}

      {editing ? (
        <form
          className="mt-3 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const reason = form.get('reason');

            void save(
              coerce(form.get('value'), setting.valueSchema, setting.value),
              typeof reason === 'string' ? reason : '',
            );
          }}
        >
          <ValueInput setting={setting} />

          <label className="grid gap-1">
            <span className="text-[10.5px] text-faint2">
              {t.sections.settings.reason}
            </span>
            <input
              name="reason"
              maxLength={500}
              className="rounded-[9px] border border-line bg-field px-2.5 py-2 text-[12.5px] text-text"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="cursor-pointer rounded-[9px] bg-[linear-gradient(135deg,#F0CB7C,#C4923E)] px-4 py-1.5 text-[11.5px] font-extrabold text-[#241A05] disabled:opacity-60"
            >
              {busy ? t.sections.settings.saving : t.sections.settings.save}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="cursor-pointer rounded-[9px] border border-line px-4 py-1.5 text-[11.5px] text-muted"
            >
              {t.sections.settings.cancel}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** The input the setting's own schema calls for. */
function ValueInput({ setting }: { setting: EditableSetting }) {
  const common =
    'w-full rounded-[9px] border border-line bg-field px-3 py-2.5 text-[13.5px] text-text';

  if (setting.valueSchema === 'boolean') {
    return (
      <label className="flex cursor-pointer items-center gap-2 text-[13px] text-text">
        <input
          type="checkbox"
          name="value"
          defaultChecked={setting.value === true}
          className="size-[15px] cursor-pointer accent-gold"
        />
        {t.sections.settings.enabled}
      </label>
    );
  }

  if (setting.valueSchema === 'feeMode') {
    return (
      <label className="grid gap-1">
        <span className="text-[10.5px] text-faint2">{t.sections.settings.mode}</span>
        <select
          name="value"
          defaultValue={String(setting.value)}
          className={`${common} cursor-pointer`}
        >
          <option value="flat">{t.sections.settings.feeFlat}</option>
          <option value="percent">{t.sections.settings.feePercent}</option>
        </select>
      </label>
    );
  }

  /*
    The compliance policy — three named values, so a select rather than a text box.

    Worth the branch: typing `requred` into a free-text field would fall back to the default at
    every read and silently change how hard a compliance control bites. The server refuses an
    unknown value too; this stops the reader ever producing one.
  */
  if (setting.valueSchema === 'sanctionsPolicy') {
    return (
      <label className="grid gap-1">
        <span className="text-[10.5px] text-faint2">{t.sections.settings.policy}</span>
        <select
          name="value"
          defaultValue={String(setting.value)}
          className={`${common} cursor-pointer`}
        >
          {SANCTIONS_POLICIES.map((policy) => (
            <option key={policy} value={policy}>
              {t.sections.settings.sanctionsPolicy[policy]}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (setting.valueSchema === 'money') {
    /**
     * Money may be stored as a bare number (USD) or `{ amount, currency }`. The
     * input edits the AMOUNT and preserves whichever shape is already stored —
     * silently converting one to the other would change what `money.always_usd`
     * applies to.
     */
    const amount = scalarText(
      typeof setting.value === 'object' && setting.value !== null
        ? (setting.value as Record<string, unknown>)['amount']
        : setting.value,
    );

    return (
      <label className="grid gap-1">
        <span className="text-[10.5px] text-faint2">
          {t.sections.settings.amount} ({currencyOf(setting.value) ?? 'USD'})
        </span>
        <input
          name="value"
          inputMode="decimal"
          defaultValue={amount}
          required
          className={common}
        />
      </label>
    );
  }

  const hint =
    setting.valueSchema === 'rate'
      ? t.sections.settings.hintRate
      : setting.valueSchema === 'hourOfDay'
        ? t.sections.settings.hintHourOfDay
        : setting.valueSchema === 'percent'
          ? t.sections.settings.hintPercent
          : t.sections.settings.hintInt;

  return (
    <label className="grid gap-1">
      <span className="text-[10.5px] text-faint2">{t.sections.settings.value}</span>
      <input
        name="value"
        inputMode="decimal"
        defaultValue={scalarText(setting.value)}
        required
        /* No `dir`: a field a person types into follows the page (docs/i18n.md §9). */
        className={common}
      />
      <span className="text-[10.5px] text-faint2">{hint}</span>
    </label>
  );
}

/**
 * Turns a form value into the JSON type the setting expects.
 *
 * A checkbox yields `"on"` or nothing; a number input yields a string. Posting those
 * as-is would fail the API's per-schema validation — which is the correct outcome,
 * but a confusing one to hit from the form that was supposed to produce valid input.
 */
function coerce(
  raw: FormDataEntryValue | null,
  valueSchema: string,
  current: unknown,
): unknown {
  if (valueSchema === 'boolean') return raw === 'on';

  const text = typeof raw === 'string' ? raw.trim() : '';

  if (valueSchema === 'feeMode' || valueSchema === 'sanctionsPolicy') return text;

  /**
   * Money keeps whichever shape it already had.
   *
   * A value stored as `{ amount, currency }` must not come back as a bare number:
   * that would silently re-denominate it in USD, which is exactly what
   * `money.always_usd` exists to make an explicit choice rather than an accident.
   * Only the amount changed, so only the amount is replaced.
   */
  if (valueSchema === 'money') {
    const currency = currencyOf(current);

    return currency === null ? Number(text) : { amount: text, currency };
  }

  return Number(text);
}

function display(value: unknown): string {
  if (typeof value === 'boolean') {
    return value ? t.sections.settings.enabled : t.sections.settings.disabled;
  }

  if (value === null || value === undefined) return t.admin.noData;
  if (typeof value === 'object') return JSON.stringify(value);

  return scalarText(value);
}

/**
 * Renders a scalar as text, and anything else as empty.
 *
 * `String(someObject)` yields "[object Object]" — which would silently become the
 * default value of an input, so a save would post that literal string. Narrowing
 * first means an unexpected shape leaves the field blank and visibly wrong.
 */
function scalarText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  return '';
}

function currencyOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;

  const currency = (value as Record<string, unknown>)['currency'];

  return typeof currency === 'string' ? currency : null;
}

function messageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('message' in body)) return null;

  const { message } = body;
  return typeof message === 'string' ? message : null;
}
