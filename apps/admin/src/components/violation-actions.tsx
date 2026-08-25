'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { Violation } from '@/lib/api';
import { ENFORCEMENT_REASON_MIN, FINE_CURRENCIES } from '@safra/contracts';

import { text } from '@/lib/form';
import { apiErrorOf, t } from '@/lib/strings';

/**
 * Taking a violation to its next stage: warn, fine, waive.
 *
 * ## The progression is the model
 *
 * مخالفة ← إنذار ← غرامة ← إيقاف (Bashar, 2026-08-24). A fine is a STAGE a violation reaches, not a
 * separate object, so these are four steps on one record rather than four things to create. Each
 * control appears only where the next step is available: nothing offers a warning on a violation
 * already warned, and nothing offers a fine where one is already attached.
 *
 * This docblock described four rungs while the component implemented three — the sentence was
 * right about the policy and wrong about the file, for as long as `stage = 'suspension'` was a value
 * nothing could write. إيقاف is the fourth, and it is here rather than only on the partner record
 * because this is the screen where somebody is looking at the violation they are acting on.
 *
 * ## Suspending goes to the PARTNER endpoint, not a violation one
 *
 * `partners/:reference/suspend` with this violation's id. `suspended_at` keeps one writer — the
 * route that also emails the partner and writes the audit row — and this screen supplies the link
 * rather than a second way to stop a business trading.
 *
 * ## Waiving is a different authority
 *
 * `violation.waive` gates it alone; `violation.manage` gates the other two. Forgiving money is not
 * the same power as recording an offence, and the console must not offer a control the API will
 * refuse — so `canWaive` comes from the reader's capabilities rather than being assumed.
 *
 * ## A waiver carries no amount
 *
 * It is always the whole fine. The API takes the figure from the stored row rather than from this
 * form, so the two cannot drift and the screen can state that they net to zero without recomputing
 * it. A form field for the amount would invite a partial waiver the ledger has no way to express.
 */
export function ViolationActions({
  violation,
  reference,
  canManage,
  canWaive,
  canSuspend,
  partnerSuspended,
}: {
  violation: Violation;
  /** The partner this violation is against — suspending is a write on the PARTNER. */
  reference: string;
  canManage: boolean;
  canWaive: boolean;
  canSuspend: boolean;
  /** Already suspended: the API answers `PARTNER_ALREADY_SUSPENDED`, so do not offer it. */
  partnerSuspended: boolean;
}) {
  const router = useRouter();

  const [open, setOpen] = useState<'warn' | 'fine' | 'waive' | 'escalate' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  /**
   * `path` rather than a step name, because the fourth rung is not a violation route.
   *
   * Warn, fine and waive are writes on the violation; suspending is a write on the PARTNER that
   * happens to name a violation. Deriving the URL from the step would have meant a special case
   * inside the one function every step shares — the place a special case is least visible.
   */
  async function submit(path: string, body: unknown, success: string): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);
    setDone(null);

    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);

        setError(apiErrorOf(payload));
        setBusy(false);

        return;
      }

      setDone(success);
      setOpen(null);
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    }

    setBusy(false);
  }

  const violationPath = (step: string): string =>
    `/api/violations/${encodeURIComponent(violation.id)}/${step}`;

  const canWarn = canManage && violation.warnedAt === null;
  const canFine = canManage && violation.fineAmount === null;
  const waivable =
    canWaive &&
    violation.fineAmount !== null &&
    !violation.waiver &&
    !violation.collectedAt;
  /*
    Three conditions, and the last is the one worth naming.

    `stage === 'suspension'` means this violation has ALREADY been cited for a suspension — the API
    treats a repeat as idempotent rather than an error, but offering a control that records nothing
    new is offering a control that does nothing. `partnerSuspended` is the other half: the API
    refuses a second suspension outright, and a button whose only outcome is a conflict is worse
    than no button.
  */
  const escalatable = canSuspend && !partnerSuspended && violation.stage !== 'suspension';

  /*
    Nothing left to offer on this row — which is a state a SUCCESSFUL action produces.

    This guard used to own the notices as well, and the write that succeeded was what tripped it: a
    waive sets `violation.waiver`, so `waivable` goes false on the `router.refresh()` that `submit`
    fires immediately after `setDone`. On a row already warned, already fined, belonging to a partner
    already suspended, all four flags then read false and the whole component — confirmation included
    — was unmounted in the same tick the confirmation was written. The operator saw the controls
    vanish and nothing else, on the one action that gives a partner their money back.

    It read as a flaky test because it is DATA-dependent, not timing-dependent: a waive on a row that
    can still be escalated keeps a control alive and the message showed. So the controls may go, and
    the notice stays until the reader navigates.
  */
  const idle = !canWarn && !canFine && !waivable && !escalatable;

  if (idle) {
    if (!error && !done) return null;

    return (
      <div className="mt-2 grid gap-2">
        <Notices error={error} done={done} />
      </div>
    );
  }

  return (
    <div className="mt-2 grid gap-2">
      <Notices error={error} done={done} />

      <div className="flex flex-wrap gap-2">
        {canWarn ? (
          <Step
            label={t.sections.enforcement.warn}
            active={open === 'warn'}
            onClick={() => setOpen(open === 'warn' ? null : 'warn')}
          />
        ) : null}
        {canFine ? (
          <Step
            label={t.sections.enforcement.fine}
            active={open === 'fine'}
            onClick={() => setOpen(open === 'fine' ? null : 'fine')}
          />
        ) : null}
        {waivable ? (
          <Step
            label={t.sections.enforcement.waive}
            active={open === 'waive'}
            onClick={() => setOpen(open === 'waive' ? null : 'waive')}
          />
        ) : null}
        {escalatable ? (
          <Step
            label={t.sections.enforcement.escalate}
            active={open === 'escalate'}
            onClick={() => setOpen(open === 'escalate' ? null : 'escalate')}
            danger
          />
        ) : null}
      </div>

      {open === 'warn' ? (
        <form
          className="grid gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const note = text(new FormData(event.currentTarget), 'note').trim();

            void submit(violationPath('warn'), { note }, t.sections.enforcement.warned);
          }}
        >
          <Reason name="note" label={t.sections.enforcement.warnNoteLabel} busy={busy} />
          <Submit
            busy={busy}
            idle={t.sections.enforcement.warn}
            working={t.sections.enforcement.warning}
          />
        </form>
      ) : null}

      {open === 'fine' ? (
        <form
          className="grid gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const compensation = text(form, 'customerCompensation').trim();

            void submit(
              violationPath('fine'),
              {
                amount: text(form, 'amount').trim(),
                /* Already a code: the select's values ARE `FINE_CURRENCIES`, so nothing to normalise. */
                currencyCode: text(form, 'currencyCode'),
                reason: text(form, 'reason').trim(),
                ...(compensation ? { customerCompensation: compensation } : {}),
              },
              t.sections.enforcement.fined,
            );
          }}
        >
          <div className="flex flex-wrap gap-2">
            <label className="grid gap-1">
              <span className="text-[11px] text-faint">
                {t.sections.enforcement.fineAmountLabel}
              </span>
              {/*
                No `dir`: a field a person types into follows the page (docs/i18n.md §9).

                And ONE backslash in `pattern`, not two. A JSX attribute written as a plain string
                is taken literally — it is not a JS string literal — so `"\\d"` reaches the DOM as a
                backslash followed by `d` and matches nothing. It silently blocked every fine: the
                form refused to submit, no request was made, and the screen showed no error because
                the browser's own validation had stopped it.
              */}
              <input
                name="amount"
                required
                inputMode="decimal"
                pattern="\d{1,10}(\.\d{1,2})?"
                placeholder={t.sections.enforcement.fineAmountPlaceholder}
                className="w-32 rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] text-faint">
                {t.sections.enforcement.fineCurrencyLabel}
              </span>
              {/*
                A MENU of the three SAFRA fines in (Bashar, 2026-08-24), not a free-text box.

                It was a three-character input, which accepted anything of that length: a typo like
                `USB` reached the API and came back a coded refusal the operator had to decode, and
                `usd` only worked because this form upper-cased it on the way out. The options come
                from `FINE_CURRENCIES` in the contract that VALIDATES the field, so the menu cannot
                offer a value the endpoint would reject, and the endpoint cannot accept one the menu
                does not offer.

                The label is the ISO code beside the symbol Arabic writes it with — «USD $»,
                «EUR €», «SYP ل.س». The code is a machine identifier and exempt from the copy rule;
                the SYMBOL is how a language writes it and comes from `currencySymbol` in the
                catalogue, which already held all three.

                No `dir`: a field a person operates follows the page's direction (UI conventions).
              */}
              <select
                name="currencyCode"
                required
                defaultValue={FINE_CURRENCIES[0]}
                className="w-28 cursor-pointer rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text"
              >
                {FINE_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {`${code} ${t.currencySymbol[code] ?? ''}`.trim()}
                  </option>
                ))}
              </select>
            </label>
            {/*
              Separate from the fine because they are two movements with two destinations. A screen
              showing only the total cannot answer "how much did the guest actually get".
            */}
            <label className="grid gap-1">
              <span className="text-[11px] text-faint">
                {t.sections.enforcement.compensationLabel}
              </span>
              <input
                name="customerCompensation"
                inputMode="decimal"
                pattern="\d{1,10}(\.\d{1,2})?"
                className="w-32 rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text"
              />
            </label>
          </div>
          <Reason
            name="reason"
            label={t.sections.enforcement.violationReasonLabel}
            busy={busy}
          />
          <Submit
            busy={busy}
            idle={t.sections.enforcement.fine}
            working={t.sections.enforcement.fining}
          />
        </form>
      ) : null}

      {open === 'waive' ? (
        <form
          className="grid gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const reason = text(new FormData(event.currentTarget), 'reason').trim();

            /* No amount: a waiver is always the whole fine — see the note above. */
            void submit(
              violationPath('waive'),
              { reason },
              t.sections.enforcement.waived,
            );
          }}
        >
          <Reason
            name="reason"
            label={t.sections.enforcement.waiveReasonLabel}
            busy={busy}
          />
          <Submit
            busy={busy}
            idle={t.sections.enforcement.waive}
            working={t.sections.enforcement.waiving}
          />
        </form>
      ) : null}

      {open === 'escalate' ? (
        <form
          className="grid gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const reason = text(new FormData(event.currentTarget), 'reason').trim();

            /*
              The PARTNER endpoint, carrying this violation's id — see the note at the top.

              No `notes` field: internal notes belong where somebody is reviewing the partner as a
              whole, and a second optional box on a control this consequential is one more thing to
              read past. The record's own form still has it.
            */
            void submit(
              `/api/partners/${encodeURIComponent(reference)}/suspend`,
              { reason, violationId: violation.id },
              t.sections.enforcement.escalated,
            );
          }}
        >
          {/*
            The consequence, before the field rather than after it.

            This is the one control here that stops a business trading, and it sits on a screen
            whose other three controls do not. Somebody who has clicked «إنذار» and «غرامة» twice is
            not reading carefully by the third, so the sentence is above the box they type into.
          */}
          <p className="text-[11.5px] leading-relaxed text-bad">
            {t.sections.enforcement.escalateHint}
          </p>
          <Reason
            name="reason"
            label={t.sections.enforcement.escalateReasonLabel}
            busy={busy}
          />
          <Submit
            busy={busy}
            idle={t.sections.enforcement.escalate}
            working={t.sections.enforcement.escalating}
          />
        </form>
      ) : null}
    </div>
  );
}

/**
 * What this component has to say, extracted because it is now rendered from two places.
 *
 * Two places rather than one is the whole point of the fix above: the notices outlive the controls.
 * Written once so the pair cannot drift — an `error` that survived and a `done` that did not would
 * be the same defect again, wearing the other half's clothes.
 */
function Notices({ error, done }: { error: string | null; done: string | null }) {
  return (
    <>
      {error ? (
        <p role="alert" className="text-[11.5px] text-bad">
          {error}
        </p>
      ) : null}
      {done ? <p className="text-[11.5px] text-ok">{done}</p> : null}
    </>
  );
}

/**
 * One rung of the progression.
 *
 * `danger` marks the rung that stops a business trading. The other three are reversible or additive
 * — a warning, a fine, a waiver — and a control with a different consequence should not be the same
 * colour as the three beside it. Matches the danger tone `PayoutActions` gives cancelling.
 */
function Step({
  label,
  active,
  onClick,
  danger,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  danger?: boolean;
}) {
  const tone = danger
    ? 'border-bad/50 text-bad hover:border-bad hover:text-bad'
    : 'border-line text-muted hover:border-gold/50 hover:text-gold';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-10 cursor-pointer items-center rounded-lg border px-3 py-1.5 text-[11.5px] lg:min-h-0 ${
        active ? (danger ? 'border-bad text-bad' : 'border-gold/60 text-gold') : tone
      }`}
    >
      {label}
    </button>
  );
}

/** Every reason on this screen is read by the partner and carries the same twenty-character floor. */
function Reason({ name, label, busy }: { name: string; label: string; busy: boolean }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] text-faint">{label}</span>
      <textarea
        name={name}
        required
        minLength={ENFORCEMENT_REASON_MIN}
        maxLength={2000}
        rows={2}
        disabled={busy}
        className="rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text disabled:cursor-not-allowed"
      />
      <span className="text-[10.5px] text-faint">
        {t.sections.enforcement.reasonHint}
      </span>
    </label>
  );
}

function Submit({
  busy,
  idle,
  working,
}: {
  busy: boolean;
  idle: string;
  working: string;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded-[9px] border border-gold/50 px-4 py-2 text-[12px] font-bold text-gold hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
    >
      {busy ? working : idle}
    </button>
  );
}
