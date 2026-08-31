'use client';

import type { ReactNode } from 'react';

import { TIMEZONE_CATALOGUE, utcOffset } from '@safra/contracts';

/**
 * The form primitives every geography panel is built from.
 *
 * ## Why they are here and not copied into each form
 *
 * They were written three times — the add forms, the city editor and the category manager — and
 * drifted the moment one of them grew a hint. Bashar screenshotted the result on 2026-08-30: in a
 * row of three, «الاسم بالعربية» rendered a visibly TALLER box than «رمز الدولة» beside it.
 *
 * ## Why that happened, and what fixes it
 *
 * A grid item stretches to its row's height by default. A field carrying a hint is taller than one
 * without, so the plain field's `<input>` — which filled its own label — grew to match the tallest
 * cell in the row. The height of a text box was therefore decided by whether the field NEXT to it
 * had explanatory text under it.
 *
 * Two things together fix it, and both are needed: the input has a FIXED height rather than one
 * derived from its container, and the row aligns its items to the start so a short field does not
 * stretch. The hint then hangs below the input, where it belongs, and every box on the screen is
 * the same size.
 */

/** The one input height on these screens — 40px, the project's control floor. */
const CONTROL =
  'h-10 rounded-[9px] border border-line bg-card px-3 text-[12.5px] text-text';

/**
 * A row of fields that share the width.
 *
 * `items-start`, so a field with a hint cannot make its neighbours taller — see the note above.
 */
export function Row({ children }: { readonly children: ReactNode }) {
  return (
    <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
  );
}

export function Field({
  label,
  value,
  onChange,
  hint,
  name,
  disabled,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange?: ((value: string) => void) | undefined;
  readonly hint?: string | undefined;
  readonly name?: string | undefined;
  /** A value the CODE decides — shown so it can be read, never typed. */
  readonly disabled?: boolean | undefined;
}) {
  return (
    <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
      {label}
      <input
        {...(name ? { name } : {})}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        readOnly={disabled ?? false}
        disabled={disabled ?? false}
        className={`${CONTROL} placeholder:text-faint ${
          disabled ? 'cursor-not-allowed bg-field text-faint' : ''
        }`}
      />
      {hint ? (
        <span className="text-[10.5px] font-normal text-faint2">{hint}</span>
      ) : null}
    </label>
  );
}

/** A `<select>` that matches `Field` exactly, so a row of both lines up. */
export function SelectField({
  label,
  value,
  onChange,
  hint,
  name,
  children,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly hint?: string | undefined;
  readonly name?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
      {label}
      <select
        {...(name ? { name } : {})}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${CONTROL} cursor-pointer`}
      >
        {children}
      </select>
      {hint ? (
        <span className="text-[10.5px] font-normal text-faint2">{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * A PARAGRAPH, for prose that renders as one.
 *
 * `Field`'s fixed 40px height is right for a name and wrong for a city description: a sentence in
 * a one-line box is read by scrolling it sideways. It keeps the same border, radius and type scale
 * so a row of three still lines up, and `items-start` on `Row` means a taller box does not stretch
 * its neighbours — the defect the fixed height exists to prevent, in the other direction.
 */
export function Prose({
  label,
  value,
  onChange,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly hint?: string | undefined;
}) {
  return (
    <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        className="rounded-[9px] border border-line bg-card px-3 py-2 text-[12.5px] leading-relaxed text-text placeholder:text-faint"
      />
      {hint ? (
        <span className="text-[10.5px] font-normal text-faint2">{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * «المنطقة الزمنية» as a MENU (Bashar, 2026-08-31), not a text box.
 *
 * ## Why this is its own component
 *
 * Two forms need it — adding a city and editing one — and it carries a rule neither should have to
 * remember: a city already stored with a zone outside the catalogue keeps it. Without that, opening
 * the editor for such a city would show the select on its first option and SAVE that on the next
 * «حفظ», silently moving the city's booking cutoff. A constrained field that quietly discards the
 * value it was given is worse than the text box it replaced.
 *
 * ## Why the offset is shown
 *
 * «Asia/Amman» and «Asia/Beirut» are two names an operator cannot tell apart by eye, and the offset
 * is the thing they are actually choosing between. It is computed, never written down: an offset is
 * a fact about a date and changes twice a year in some of these zones.
 *
 * The identifier itself stays Latin and untranslated — `docs/i18n.md` lists an identifier from a
 * standard as an exception, the same reason a currency CODE is not copy.
 */
export function TimezoneField({
  label,
  value,
  onChange,
  hint,
  now,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly hint?: string | undefined;
  /**
   * The instant offsets are computed against.
   *
   * Passed in rather than read here so the server and the browser agree on the first paint: a
   * `new Date()` inside a component renders one string on the server and possibly another on the
   * client, which is a hydration mismatch that appears twice a year and never in a test.
   */
  readonly now: Date;
}) {
  /* The catalogue, plus whatever this city already has — see the note above. */
  const options =
    TIMEZONE_CATALOGUE.includes(value) || value === ''
      ? TIMEZONE_CATALOGUE
      : [value, ...TIMEZONE_CATALOGUE];

  return (
    <SelectField
      label={label}
      name="timezone"
      value={value}
      onChange={onChange}
      hint={hint}
    >
      {options.map((zone) => (
        <option key={zone} value={zone}>
          {`${zone} · ${utcOffset(zone, now)}`}
        </option>
      ))}
    </SelectField>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean | undefined;
  readonly hint?: string | undefined;
}) {
  return (
    <div className="grid gap-1">
      <label
        className={`flex items-center gap-2.5 text-[12.5px] text-text2 ${
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled ?? false}
          onChange={(event) => onChange(event.target.checked)}
          className="size-[15px] cursor-pointer accent-gold disabled:cursor-not-allowed"
        />
        {label}
      </label>
      {hint ? <span className="text-[10.5px] text-faint2">{hint}</span> : null}
    </div>
  );
}

/**
 * The panel a form opens into.
 *
 * `bare` for one rendered INSIDE a `Modal`: the popup already draws a bordered card, and a second
 * border with its own background inside it reads as a box in a box. The heading and the `data-*`
 * marker stay either way — the marker is how a browser test finds the form, and it must not depend
 * on where the form is drawn.
 */
export function Panel({
  heading,
  marker,
  attribute = 'data-geo-form',
  bare,
  children,
}: {
  readonly heading: string;
  readonly marker: string;
  /** Which `data-*` a browser test finds this by. */
  readonly attribute?: string | undefined;
  readonly bare?: boolean | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div
      {...{ [attribute]: marker }}
      className={`grid w-full gap-3 text-start ${
        bare ? '' : 'mb-3 rounded-[10px] border border-line bg-field p-4'
      }`}
    >
      <p className="text-[11.5px] font-bold text-gold">{heading}</p>
      {children}
    </div>
  );
}

/**
 * Save, cancel, the refusal — and, on an editor, delete.
 *
 * ## Why delete sits at the far END of the row
 *
 * `ms-auto` puts it against the opposite edge from «حفظ», with the whole width between them. A
 * destructive control beside the one somebody presses every time is a mis-click waiting to happen,
 * and this row is pressed on every edit. It is also the only control here that is not gold or
 * grey: red is the one signal that reads before the word does.
 *
 * Omitted entirely when `onDelete` is absent — the add forms have nothing to delete, and a
 * disabled «حذف» on a form that is creating something would be a control explaining nothing.
 */
export function Actions({
  busy,
  ready,
  error,
  saveLabel,
  busyLabel,
  cancelLabel,
  deleteLabel,
  deletingLabel,
  deleting,
  onSave,
  onClose,
  onDelete,
}: {
  readonly busy: boolean;
  readonly ready: boolean;
  readonly error: string | null;
  readonly saveLabel: string;
  readonly busyLabel: string;
  readonly cancelLabel: string;
  readonly deleteLabel?: string | undefined;
  readonly deletingLabel?: string | undefined;
  readonly deleting?: boolean | undefined;
  readonly onSave: () => void;
  readonly onClose: () => void;
  /** Absent on a create form. Present on an editor, where the row already exists. */
  readonly onDelete?: (() => void) | undefined;
}) {
  return (
    <>
      {error ? <p className="text-[11px] font-semibold text-bad">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button
          type="button"
          disabled={busy || !ready}
          /* Named, so a form containing other save buttons — a city and its photographs — can
             still be submitted unambiguously by a browser test. */
          data-geo-save
          onClick={onSave}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-gold px-4.5 py-2 text-xs font-bold text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
        >
          {busy ? busyLabel : saveLabel}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-4 py-2 text-xs font-bold text-muted transition-colors hover:text-text lg:min-h-0"
        >
          {cancelLabel}
        </button>

        {onDelete && deleteLabel ? (
          <button
            type="button"
            data-geo-delete
            disabled={busy || deleting}
            onClick={onDelete}
            className="ms-auto inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-bad/45 px-4 py-2 text-xs font-bold text-bad transition-colors hover:bg-bad/10 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
          >
            {deleting ? (deletingLabel ?? deleteLabel) : deleteLabel}
          </button>
        ) : null}
      </div>
    </>
  );
}
