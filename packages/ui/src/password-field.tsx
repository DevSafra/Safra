'use client';

import { useId, useState } from 'react';

export interface PasswordFieldProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type'
> {
  readonly label: string;
  readonly hint?: string | undefined;
  /** A per-field validation message from the server, shown under the input. */
  readonly error?: string | undefined;
  /**
   * Renders the `*` the customer app marks required fields with.
   *
   * `aria-hidden`, so it is decoration rather than part of the accessible name — a
   * screen reader announcing "Password star" is worse than "Password", and the input's
   * own `required` already conveys the constraint. It also keeps the label matchable by
   * its actual text, which is how a browser test finds the field.
   */
  readonly showRequiredMark?: boolean;
  readonly ref?: React.Ref<HTMLInputElement>;
}

/**
 * A password input with a show/hide toggle.
 *
 * **Every password field in SAFRA uses this — that is a project rule, not a preference**
 * (Bashar, 2026-08-03). It lives in a shared package rather than being copied into each
 * app precisely so the rule is structural: a new password input either imports this and
 * gets the toggle, or it is visibly not using the shared component.
 *
 * ## Why a toggle at all
 *
 * A masked field with no way to reveal it makes people mistype, and the accounts that
 * suffer most are the ones with the strongest passwords — long, generated, and impossible
 * to verify by feel. On the staff console the cost of a mistyped password is worse than
 * an error message: it consumes one of five attempts before the account locks.
 *
 * ## Why the toggle is a button, not a checkbox
 *
 * `type="button"` with `aria-pressed` announces state to a screen reader and cannot
 * submit the form. A checkbox would be tab-reachable in the middle of the credentials and
 * read as a form value; an `<a>` or a `<div>` would not be keyboard-operable at all.
 *
 * `tabIndex={-1}` keeps it out of the tab order: the expected path from a password field
 * is straight to the submit button, and a toggle in between is a snag for anyone typing
 * without a mouse. It stays clickable, and screen-reader users reach it by other means.
 */
export function PasswordField({
  label,
  hint,
  error,
  showRequiredMark,
  ref,
  ...rest
}: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);

  /**
   * `useId` rather than deriving from `name`: two password fields in one form — "new"
   * and "confirm" — must not share a label association, and a caller should not have to
   * think about that.
   */
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
        {showRequiredMark ? (
          <span aria-hidden="true" className="text-gold">
            {' '}
            *
          </span>
        ) : null}
      </label>

      <div className="relative">
        <input
          id={id}
          ref={ref}
          type={revealed ? 'text' : 'password'}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy || undefined}
          /**
           * `pr-11` leaves room for the button so a long value does not run underneath
           * it. Everything else matches the plain inputs around it.
           */
          className={`w-full rounded-lg border bg-field px-3 py-2.5 pr-11 text-text ${
            error ? 'border-bad' : 'border-line'
          }`}
          {...rest}
        />

        <button
          type="button"
          onClick={() => setRevealed((shown) => !shown)}
          aria-pressed={revealed}
          aria-label={revealed ? 'Hide password' : 'Show password'}
          title={revealed ? 'Hide password' : 'Show password'}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 grid w-11 cursor-pointer place-items-center text-muted transition-colors hover:text-gold"
        >
          {revealed ? <EyeOff /> : <Eye />}
        </button>
      </div>

      {hint ? (
        <span id={hintId} className="text-xs text-faint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="text-xs text-bad">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Inline SVG rather than an icon dependency.
 *
 * Two glyphs do not justify a package, and the Content-Security-Policy forbids remote
 * assets — an icon font or a CDN sprite would be blocked. `aria-hidden` because the
 * button already carries the label.
 */
function Eye() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a18.4 18.4 0 0 1-2.4 3.4" />
      <path d="M6.5 6.6A18.2 18.2 0 0 0 2 12s3.6 7 10 7a10.6 10.6 0 0 0 4-.7" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}
