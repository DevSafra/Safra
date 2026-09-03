'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useRouter } from 'next/navigation';

import { SANCTIONS_POLICIES } from '@safra/contracts';
import type { ConfirmRequest } from '@safra/ui';

import type { EditableSetting } from '@/lib/api';
import { Chip, Ltr } from '@/components/admin-table';
import { SettingDetails } from '@/components/setting-details';
import { apiErrorOf, fill, t } from '@/lib/strings';
import { shortDate } from '@/lib/format';
import {
  editableText,
  isEditableSchema,
  moneyOf,
  ratePercentEcho,
  schemaHint,
  settingDisplay,
  settingName,
  type SettingDisplay,
} from '@/lib/settings-display';

/**
 * One setting, read at a glance and saved on its own (§9.3, P-005).
 *
 * ## Saved per row, still
 *
 * A bulk save turns somebody else's concurrent edit into a silent revert, and it makes the audit
 * trail read as though one person changed everything at once — which is precisely the question the
 * trail exists to answer correctly. Unchanged from the first version of this screen; the API is
 * built the same way, one key per call.
 *
 * ## What changed, and why the row is a ROW now
 *
 * It was a cell in an `auto-fit` grid. Three consequences, all visible in a screenshot at 1440:
 * the cells had unequal heights so nothing lined up across a group; «تعديل» was pushed to the far
 * inline-end of each cell, which at 390px put the button on the line ABOVE the label it belonged
 * to; and opening one editor reflowed the whole grid.
 *
 * A list of rows fixes all three by construction — the label reads down one column, the value down
 * another, and an editor expands into the space under its own row.
 *
 * ## A boolean is a switch
 *
 * `money.always_usd` took four interactions to flip: «تعديل», the checkbox, «حفظ», and reading the
 * result. It is one now, and the question that used to be implicit in a form is asked out loud
 * first — every one of these takes effect on the platform immediately, and one of them signs
 * everybody in a role out.
 */
export function SettingRow({
  setting,
  alwaysUsd,
  ask,
}: {
  setting: EditableSetting;
  alwaysUsd: boolean;
  /** The board's one `useConfirm().ask` — a dialog per row would be seventeen dialogs. */
  ask: (request: ConfirmRequest) => Promise<boolean>;
}) {
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [showingDetails, setShowingDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');

  const valueField = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  const editable = isEditableSchema(setting.valueSchema);
  const display = settingDisplay(setting, alwaysUsd);
  /*
    The catalogue's Arabic name, falling back to the database description and then to the key.

    The database column held the label before, which meant the console's own words lived in one
    language in one column — invisible to the task of adding a language, and already carrying
    «Pending Payment» in the middle of an Arabic sentence.
  */
  const name = settingName(setting);

  /*
    Focus moves to the field when the editor opens.

    A `useEffect` rather than `autoFocus`: the attribute is flagged by the a11y lint rule and it
    also fires on the server-rendered pass, which would steal focus on a page load rather than on
    a deliberate press.
  */
  useEffect(() => {
    if (editing) valueField.current?.focus();
  }, [editing]);

  function open() {
    setTyped(editableText(setting));
    setError(null);
    setEditing(true);
  }

  async function save(value: unknown, reason: string) {
    if (busy) return false;

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
        setError(apiErrorOf(body));
        setBusy(false);
        return false;
      }

      setEditing(false);
      router.refresh();
      setBusy(false);
      return true;
    } catch {
      setError(t.errors.unreachable);
      setBusy(false);
      return false;
    }
  }

  /**
   * A flag, flipped after the consequence has been read.
   *
   * The danger tone is for the grants: `rbac.*` revokes every session of that role on the way
   * DOWN, so somebody working right now is signed out. It paints the confirm red and puts the
   * initial focus on «إلغاء», which is the half that protects a person.
   */
  async function toggle(next: boolean) {
    const revokes = !next && setting.key.startsWith('rbac.');

    const confirmed = await ask({
      title: t.sections.settings.toggleTitle,
      message: revokes
        ? fill(t.sections.settings.toggleRevokes, { name })
        : fill(
            next ? t.sections.settings.toggleEnable : t.sections.settings.toggleDisable,
            { name },
          ),
      confirmLabel: t.sections.dialog.confirm,
      cancelLabel: t.sections.dialog.cancel,
      ...(revokes ? { tone: 'danger' as const } : {}),
    });

    if (!confirmed) return;

    await save(next, '');
  }

  return (
    /*
      `data-setting-row` is the browser test's handle on one row, the way `data-status-pill` is its
      handle on one status. Locating a row by its Arabic label would break on the next wording
      change, which is copy and changes freely; the key is the row's identity.
    */
    <div
      data-setting-row={setting.key}
      className="border-t border-line2 py-3.5 first:border-t-0 first:pt-0"
    >
      {/*
        Three columns at `sm` and up — label, value, action — and two below it, with the label
        spanning them.

        Below `sm` the value and the action share a line UNDER the label. Giving the action a line
        of its own is what the `auto-fit` grid this replaced did at 390px, and because the cell was
        `ms-auto` inside a wrapping flex row the button landed ABOVE the label it belonged to.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,22rem)_minmax(0,1fr)_auto] sm:gap-x-5">
        <div className="col-span-2 min-w-0 sm:col-span-1">
          {/*
            The label is the setting's Arabic NAME from the catalogue — never the key.

            The key used to sit right under it in Latin monospace, eighteen times down an Arabic
            page. `docs/i18n.md` lists a setting key under «what is NOT copy» because a machine
            reads it, which is precisely why it does not belong in a line a person reads. It is in
            «التفاصيل», with the value's type and the change log (Bashar, 2026-08-31).
          */}
          <p className="text-[12.5px] leading-snug font-semibold text-text2">{name}</p>

          {editable ? null : (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <Chip tone="faint">{t.sections.settings.readOnly}</Chip>
              <span className="text-[10.5px] leading-relaxed text-faint">
                {t.sections.settings.notEditable}
              </span>
            </p>
          )}

          {/*
            Only where there IS one. Fifteen of the seventeen rows are seeded defaults, so a
            «never changed» counterpart would repeat fifteen times and say nothing.
          */}
          {setting.updatedByEmail ? (
            <p className="mt-1 text-[10.5px] text-faint">
              {fill(t.sections.settings.lastChanged, {
                who: setting.updatedByEmail,
                when: shortDate(setting.updatedAt),
              })}
            </p>
          ) : null}
        </div>

        {/*
          The value in a column of its own, so a group of figures can be read down one edge.

          The label column is CAPPED rather than `1fr`: with the value pinned to the far inline-end
          of a 1380px console there were four hundred empty pixels between «رسوم خدمة العميل» and
          `$1.99`, and pairing a label with its own value meant crossing them. The cap puts the
          figures a short saccade from the words they belong to and still lines them up.

          A block kind — a routing table — leaves this cell empty and draws itself under the row,
          because it is a table and not a figure beside a label.
        */}
        <div className="min-w-0">
          {isBlock(display) ? null : <Value display={display} />}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/*
            «التفاصيل» is on EVERY row, editable or not: it is where the key, the value's type and
            the change history live, and all three are questions a person asks about a setting they
            cannot change just as often as about one they can.
          */}
          <button
            type="button"
            onClick={() => setShowingDetails(!showingDetails)}
            aria-expanded={showingDetails}
            className="cursor-pointer rounded-lg px-2 py-1 text-[11px] text-faint transition-colors hover:text-gold"
          >
            {showingDetails
              ? t.sections.settings.detailsHide
              : t.sections.settings.details}
          </button>

          {editable && display.kind === 'flag' ? (
            <Switch
              on={display.on}
              label={name}
              busy={busy}
              onToggle={() => void toggle(!display.on)}
            />
          ) : null}

          {editable && display.kind !== 'flag' && !editing ? (
            <button
              type="button"
              onClick={open}
              className="cursor-pointer rounded-lg border border-line px-3 py-1 text-[11px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.5)] hover:text-gold"
            >
              {t.sections.settings.change}
            </button>
          ) : null}
        </div>
      </div>

      {/*
        The payment routing table, as rows rather than as the JSON it is stored as.

        It was `JSON.stringify(value, null, 2)` in a monospace block. An operator's question is
        «which rail will a Syrian customer meet», and `{"*":["manual_transfer"],"SY":[…]}` does not
        answer it — the country was an ISO code and the rail was a slug, both in English, on an
        Arabic screen (Bashar, 2026-08-31).
      */}
      {display.kind === 'routing' ? (
        <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-field">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="border-b border-line2 text-[10px] text-faint2">
                <th scope="col" className="px-3 py-1.5 text-start font-semibold">
                  {t.sections.settings.routingCountry}
                </th>
                <th scope="col" className="px-3 py-1.5 text-start font-semibold">
                  {t.sections.settings.routingProvider}
                </th>
              </tr>
            </thead>
            <tbody>
              {display.rows.map((row) => (
                <tr key={row.place} className="border-t border-line2 first:border-t-0">
                  <td
                    className={`px-3 py-1.5 ${row.isFallback ? 'text-faint' : 'text-text2'}`}
                  >
                    {row.place}
                  </td>
                  <td className="px-3 py-1.5 text-text">
                    {row.providers.join(' · ')}
                    {/* Only worth saying when there is an order to state. */}
                    {row.providers.length > 1 ? (
                      <span className="ms-1.5 text-[10px] text-faint">
                        {t.sections.settings.routingOrder}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/*
        A nested object this console has no reader for. Still shown — hiding a setting is worse than
        an ugly one — and scrolling inside its own box, because a wide block must never push the
        page sideways and take the sidebar with it.
      */}
      {display.kind === 'json' ? (
        <pre
          dir="ltr"
          className="mt-2 overflow-x-auto rounded-lg border border-line bg-field p-2.5 font-mono text-[10.5px] leading-relaxed text-text2"
        >
          {display.text}
        </pre>
      ) : null}

      {showingDetails ? <SettingDetails setting={setting} alwaysUsd={alwaysUsd} /> : null}

      {error ? (
        <p role="alert" className="mt-2 text-[11.5px] text-bad">
          {error}
        </p>
      ) : null}

      {editing ? (
        <form
          className="mt-3 rounded-lg border border-[rgba(var(--goldA),0.22)] bg-field p-3.5"
          onSubmit={(event) => {
            event.preventDefault();

            const form = new FormData(event.currentTarget);
            const reason = form.get('reason');

            void save(
              coerce(typed, setting.valueSchema, setting.value),
              typeof reason === 'string' ? reason : '',
            );
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <ValueInput
              setting={setting}
              typed={typed}
              onTyped={setTyped}
              fieldRef={valueField}
            />

            <label className="grid content-start gap-1">
              <span className="text-[10.5px] text-faint2">
                {t.sections.settings.reason}
              </span>
              <input
                name="reason"
                maxLength={500}
                className="rounded-lg border border-line bg-card px-2.5 py-2 text-[12.5px] text-text"
              />
            </label>
          </div>

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="cursor-pointer rounded-lg bg-[linear-gradient(135deg,#F0CB7C,#C4923E)] px-4 py-1.5 text-[11.5px] font-extrabold text-[#241A05] disabled:cursor-default disabled:opacity-60"
            >
              {busy ? t.sections.settings.saving : t.sections.settings.save}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="cursor-pointer rounded-lg border border-line px-4 py-1.5 text-[11.5px] text-muted"
            >
              {t.sections.settings.cancel}
            </button>

            <span className="text-[10.5px] text-faint">
              {t.sections.settings.auditNote}
            </span>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** A kind that draws itself UNDER the row rather than in the value column. */
function isBlock(
  display: SettingDisplay,
): display is Extract<SettingDisplay, { kind: 'json' | 'routing' }> {
  return display.kind === 'json' || display.kind === 'routing';
}

/**
 * The value, rendered the way its own kind asks to be.
 *
 * The block kinds are excluded by the TYPE, not by a branch that returns null: a routing table is
 * a table under the row, not a figure beside a label. Excluding them here means adding a value
 * kind cannot quietly fall through to the number rendering.
 */
function Value({
  display,
}: {
  display: Exclude<SettingDisplay, { kind: 'json' | 'routing' }>;
}) {
  if (display.kind === 'missing') {
    return <span className="text-[13.5px] text-faint">{t.admin.noData}</span>;
  }

  if (display.kind === 'flag') {
    return (
      <span
        className={`text-[13.5px] font-bold ${display.on ? 'text-ok' : 'text-faint'}`}
      >
        {display.on ? t.sections.settings.enabled : t.sections.settings.disabled}
      </span>
    );
  }

  if (display.kind === 'choice') {
    return (
      <span className="block max-w-[30ch] text-[12.5px] leading-snug font-bold text-text">
        {display.text}
      </span>
    );
  }

  if (display.kind === 'text') {
    return (
      <Ltr className="max-w-[30ch] text-[12.5px] leading-snug font-bold text-text">
        {display.text}
      </Ltr>
    );
  }

  if (display.kind === 'money') {
    return (
      <>
        <Ltr className="block text-[15px] font-extrabold text-text">{display.text}</Ltr>
        {display.note ? (
          <span className="mt-0.5 block max-w-[34ch] text-[10px] leading-relaxed text-warn">
            {display.note}
          </span>
        ) : null}
      </>
    );
  }

  return (
    <>
      {/*
        The figure isolated, the Arabic unit beside it as ordinary text.

        Not one string: «120 دقيقة» composed together and set in an RTL line renders as
        «دقيقة 120», because the digits are a left-to-right run inside a right-to-left paragraph.
        `docs/i18n.md` §9 — isolate the VALUE, never the label.
      */}
      <span className="block text-[15px] font-extrabold text-text">
        <Ltr>{display.text}</Ltr>
        {display.unit ? <span className="ms-1">{display.unit}</span> : null}
      </span>

      {/*
        The aside is Arabic that may CONTAIN a figure — «المخزَّن: 0.07». It carries its own
        isolate inside the string, so the element must NOT override the direction.
      */}
      {display.aside ? (
        <span className="mt-0.5 block text-[10px] text-faint">{display.aside}</span>
      ) : null}
    </>
  );
}

/**
 * An on/off control, `role="switch"` so it announces its state rather than its label alone.
 *
 * 40px tall below `lg`, where the input is a finger, and compact above it — the console's own
 * control floor, met by the element rather than by the zero-specificity rule in `globals.css`
 * stretching a 24px track to 40.
 *
 * The knob travels toward the inline END when on, so it mirrors with the page. That is not in
 * tension with «arrows are not mirrored»: an arrow key means a physical direction of travel
 * through a list, and a switch means "further along the way this page reads".
 */
function Switch({
  on,
  label,
  busy,
  onToggle,
}: {
  on: boolean;
  label: string;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      onClick={onToggle}
      className="flex h-10 shrink-0 cursor-pointer items-center disabled:cursor-default disabled:opacity-60 lg:h-6"
    >
      <span
        className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${
          on ? 'justify-end bg-ok' : 'justify-start bg-line'
        }`}
      >
        <span className="block size-4 rounded-full bg-card" />
      </span>
    </button>
  );
}

/** The input the setting's own schema calls for. */
function ValueInput({
  setting,
  typed,
  onTyped,
  fieldRef,
}: {
  setting: EditableSetting;
  typed: string;
  onTyped: (value: string) => void;
  fieldRef: RefObject<HTMLInputElement | HTMLSelectElement | null>;
}) {
  const common =
    'w-full rounded-lg border border-line bg-card px-3 py-2.5 text-[13.5px] text-text';

  if (setting.valueSchema === 'feeMode') {
    return (
      <label className="grid content-start gap-1">
        <span className="text-[10.5px] text-faint2">{t.sections.settings.mode}</span>
        <select
          ref={(node) => {
            fieldRef.current = node;
          }}
          value={typed}
          onChange={(event) => onTyped(event.target.value)}
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
      <label className="grid content-start gap-1">
        <span className="text-[10.5px] text-faint2">{t.sections.settings.policy}</span>
        <select
          ref={(node) => {
            fieldRef.current = node;
          }}
          value={typed}
          onChange={(event) => onTyped(event.target.value)}
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

  /**
   * Money edits the AMOUNT and preserves the currency already stored.
   *
   * Silently converting `{ amount, currency }` to a bare number would re-denominate the row in
   * USD, which is the choice `money.always_usd` exists to make explicit rather than accidental.
   */
  const currency =
    setting.valueSchema === 'money' ? moneyOf(setting.value)?.currency : undefined;

  const echo = setting.valueSchema === 'rate' ? ratePercentEcho(typed) : null;

  return (
    <label className="grid content-start gap-1">
      <span className="text-[10.5px] text-faint2">
        {setting.valueSchema === 'money'
          ? `${t.sections.settings.amount} (${currency})`
          : t.sections.settings.value}
      </span>
      <input
        ref={(node) => {
          fieldRef.current = node;
        }}
        inputMode="decimal"
        value={typed}
        onChange={(event) => onTyped(event.target.value)}
        required
        /* No `dir`: a field a person types into follows the page (docs/i18n.md §9). */
        className={common}
      />
      {/*
        A rate is the one field whose unit differs from the unit the reader is thinking in, and
        `0.7` for `0.07` passes validation while multiplying every commission by ten. The echo is
        the only place that mistake becomes visible before it is saved — so it gets its own line
        above the hint, in the gold the rest of the console uses for a live figure, rather than
        being read as the first two words of a sentence about fractions.
      */}
      {echo ? <span className="text-[11px] font-bold text-gold">{echo}</span> : null}

      <span className="text-[10.5px] text-faint2">{schemaHint(setting.valueSchema)}</span>
    </label>
  );
}

/**
 * Turns the typed text into the JSON type the setting expects.
 *
 * A number input yields a string, and posting that as-is would fail the API's per-schema
 * validation — the correct outcome, but a confusing one to hit from the form that was supposed to
 * produce valid input.
 */
function coerce(text: string, valueSchema: string, current: unknown): unknown {
  const trimmed = text.trim();

  /* A boolean never reaches here — the switch posts a real boolean, with no form in between. */
  if (valueSchema === 'feeMode' || valueSchema === 'sanctionsPolicy') return trimmed;

  /**
   * Money keeps whichever shape it already had.
   *
   * A value stored as `{ amount, currency }` must not come back as a bare number: that would
   * silently re-denominate it in USD, which is the choice `money.always_usd` exists to make
   * explicit rather than accidental. Only the amount changed, so only the amount is replaced —
   * and a row that states no currency of its own stays a bare number.
   */
  if (valueSchema === 'money') {
    const currency = statedCurrency(current);

    return currency === null ? Number(trimmed) : { amount: trimmed, currency };
  }

  return Number(trimmed);
}

/**
 * The currency the stored value ITSELF names, or `null` when it names none.
 *
 * Deliberately not `moneyOf`, which fills in `DEFAULT_MONEY_CURRENCY` so a reader always sees a
 * currency. Writing that default back would change a bare number into an object on the first save
 * — a shape change nobody asked for, on a row every booking's pricing reads.
 */
function statedCurrency(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;

  const currency = (value as Record<string, unknown>)['currency'];

  return typeof currency === 'string' ? currency : null;
}
