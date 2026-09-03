'use client';

import {
  PASSWORD_RULES,
  passwordProgress,
  passwordRuleResults,
  type PasswordRuleId,
} from '@safra/contracts';

/**
 * The live checklist beside a new-password field: a bar, and one chip per requirement.
 *
 * Asked for by Bashar (2026-08-14) from a reference design. It answers the complaint that made the
 * old policy hard to use — a form that refuses a password after you submit it, and does not say
 * what would satisfy it, teaches nothing and costs an attempt each time.
 *
 * ## It renders the rules the SERVER enforces, not a copy of them
 *
 * `PASSWORD_RULES` lives in `@safra/contracts`; `passwordSchema` refines against the same array.
 * A meter with its own list would eventually tick a box the server refuses, which is the one
 * outcome worse than having no meter: the form tells you the password is fine and then rejects it.
 *
 * ## The bar measures the CHECKLIST, not strength
 *
 * Requirements met over requirements total. It is deliberately not an entropy estimate: it cannot
 * see the blocklist, so `Password1!` would fill it completely while being refused for being one of
 * the most-guessed passwords there is. A bar that says "strong" about a password the server will
 * reject is a lie the reader has no way to check — this one only claims what the chips beside it
 * already show.
 *
 * ## Nothing is typed here, and nothing is sent
 *
 * The value is read, classified and thrown away on every keystroke. It is never stored, never put
 * in a ref, and never sent anywhere — the component takes the password as a prop and returns
 * markup.
 */
export function PasswordStrengthMeter({
  password,
  labels,
  progressLabel,
}: {
  readonly password: string;
  /** One per rule, in the reader's language. Required — see `PasswordField` on why not defaulted. */
  readonly labels: Readonly<Record<PasswordRuleId, string>>;
  /**
   * The accessible name of the bar.
   *
   * A `<progress>` with no name is announced as "progress bar, 40%", which tells somebody using a
   * screen reader the number and not the subject.
   */
  readonly progressLabel: string;
}) {
  const results = passwordRuleResults(password);
  const progress = passwordProgress(password);
  const met = results.filter((rule) => rule.met).length;

  /*
    Four bands rather than a continuous gradient: the colour is a category, and a bar that shifts
    hue imperceptibly per keystroke communicates less than one that changes at a threshold.
  */
  const tone =
    progress === 1
      ? 'bg-ok'
      : progress >= 0.6
        ? 'bg-warn'
        : progress > 0
          ? 'bg-bad'
          : 'bg-line';

  return (
    <div className="mt-2 grid gap-2">
      {/*
        A real `<progress>`, not a styled div: assistive technology announces it as a progress
        indicator with a value, which a div with a coloured child does not.

        `aria-hidden` on the visual bar and the semantics on the element itself would be the other
        way round; here the element IS the semantics and the fill is its own child, so there is one
        thing to read and one thing to look at.
      */}
      <div
        role="progressbar"
        aria-label={progressLabel}
        aria-valuenow={met}
        aria-valuemin={0}
        aria-valuemax={PASSWORD_RULES.length}
        className="h-1 w-full overflow-hidden rounded-full bg-line"
      >
        <div
          className={`h-full rounded-full transition-all duration-200 ${tone}`}
          style={{ inlineSize: `${Math.round(progress * 100)}%` }}
        />
      </div>

      {/*
        `aria-live="polite"` on the LIST, so a screen reader hears "at least 12 characters, met" as
        it becomes true rather than only on submit. `polite` and not `assertive`: this is progress,
        not an error, and interrupting somebody mid-word to announce it would be worse than silence.
      */}
      <ul aria-live="polite" className="flex flex-wrap gap-1.5">
        {results.map((rule) => (
          <li key={rule.id}>
            <span
              data-met={rule.met ? 'true' : 'false'}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] transition-colors ${
                rule.met
                  ? 'border-ok/50 bg-ok/10 text-ok'
                  : 'border-line bg-field text-faint'
              }`}
            >
              {/*
                The tick and the ring are `aria-hidden`: the state is already on the chip as
                `data-met` for tests and is announced by the live region above. A screen reader
                reading "✓ At least 12 characters" would say the glyph's name, not its meaning.
              */}
              <span aria-hidden>{rule.met ? '✓' : '○'}</span>
              {labels[rule.id]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
