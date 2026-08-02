'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { EditableSetting } from '@/lib/api';

/** Schemas this form knows how to render an input for. */
const EDITABLE = new Set([
  'rate',
  'percent',
  'positiveInt',
  'hourOfDay',
  'money',
  'boolean',
  'feeMode',
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
        setError(messageOf(body) ?? 'Could not save that value.');
        setBusy(false);
        return;
      }

      setEditing(false);
      router.refresh();
      setBusy(false);
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-faint">{setting.key}</p>
          <p className="mt-0.5 text-sm text-text">{display(setting.value)}</p>
          {setting.descriptionEn ? (
            <p className="mt-1 text-xs text-muted">{setting.descriptionEn}</p>
          ) : null}
          {setting.updatedByEmail ? (
            <p className="mt-1 text-xs text-faint">
              Last changed by {setting.updatedByEmail}
              {setting.updatedAt ? ` on ${setting.updatedAt.slice(0, 10)}` : ''}
            </p>
          ) : null}
        </div>

        {editable && !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-gold/50 hover:text-gold"
          >
            Change
          </button>
        ) : null}
      </div>

      {!editable ? (
        <p className="mt-2 rounded border border-line bg-field px-3 py-2 text-xs text-faint">
          This setting is a <code>{setting.valueSchema}</code>, which this form cannot
          validate. Changing it from a generic input risks breaking it silently, so it
          stays a deliberate change made with review.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-bad">
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
            <span className="text-xs text-muted">Why? Recorded against the change.</span>
            <input
              name="reason"
              maxLength={500}
              className="rounded-lg border border-line bg-field px-3 py-2 text-sm text-text"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** The input the setting's own schema calls for. */
function ValueInput({ setting }: { setting: EditableSetting }) {
  const common = 'rounded-lg border border-line bg-field px-3 py-2 text-sm text-text';

  if (setting.valueSchema === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          name="value"
          defaultChecked={setting.value === true}
          className="accent-gold"
        />
        Enabled
      </label>
    );
  }

  if (setting.valueSchema === 'feeMode') {
    return (
      <label className="grid gap-1">
        <span className="text-xs text-muted">Mode</span>
        <select name="value" defaultValue={String(setting.value)} className={common}>
          <option value="flat">flat — a fixed amount per booking</option>
          <option value="percent">percent — a share of the stay</option>
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
        <span className="text-xs text-muted">
          Amount{currencyOf(setting.value) ? ` (${currencyOf(setting.value)})` : ' (USD)'}
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
      ? 'A fraction between 0 and 1 — 7% is 0.07.'
      : setting.valueSchema === 'hourOfDay'
        ? 'An hour from 0 to 23, in the city’s local time.'
        : setting.valueSchema === 'percent'
          ? 'A number from 0 to 100.'
          : 'A whole number.';

  return (
    <label className="grid gap-1">
      <span className="text-xs text-muted">Value</span>
      <input
        name="value"
        inputMode="decimal"
        defaultValue={scalarText(setting.value)}
        required
        className={common}
      />
      <span className="text-xs text-faint">{hint}</span>
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

  if (valueSchema === 'feeMode') return text;

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
  if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
  if (value === null || value === undefined) return '—';
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
