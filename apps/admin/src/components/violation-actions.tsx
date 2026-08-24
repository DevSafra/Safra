'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { Violation } from '@/lib/api';
import { ENFORCEMENT_REASON_MIN } from '@safra/contracts';

import { text } from '@/lib/form';
import { apiErrorOf, t } from '@/lib/strings';

/**
 * Taking a violation to its next stage: warn, fine, waive.
 *
 * ## The progression is the model
 *
 * مخالفة ← إنذار ← غرامة ← إيقاف (Bashar, 2026-08-24). A fine is a STAGE a violation reaches, not a
 * separate object, so these are three steps on one record rather than three things to create. Each
 * control appears only where the next step is available: nothing offers a warning on a violation
 * already warned, and nothing offers a fine where one is already attached.
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
  canManage,
  canWaive,
}: {
  violation: Violation;
  canManage: boolean;
  canWaive: boolean;
}) {
  const router = useRouter();

  const [open, setOpen] = useState<'warn' | 'fine' | 'waive' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(
    step: 'warn' | 'fine' | 'waive',
    body: unknown,
    success: string,
  ): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);
    setDone(null);

    try {
      const response = await fetch(
        `/api/violations/${encodeURIComponent(violation.id)}/${step}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

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

  const canWarn = canManage && violation.warnedAt === null;
  const canFine = canManage && violation.fineAmount === null;
  const waivable =
    canWaive &&
    violation.fineAmount !== null &&
    !violation.waiver &&
    !violation.collectedAt;

  if (!canWarn && !canFine && !waivable) return null;

  return (
    <div className="mt-2 grid gap-2">
      {error ? (
        <p role="alert" className="text-[11.5px] text-bad">
          {error}
        </p>
      ) : null}
      {done ? <p className="text-[11.5px] text-ok">{done}</p> : null}

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
      </div>

      {open === 'warn' ? (
        <form
          className="grid gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const note = text(new FormData(event.currentTarget), 'note').trim();

            void submit('warn', { note }, t.sections.enforcement.warned);
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
              'fine',
              {
                amount: text(form, 'amount').trim(),
                currencyCode: text(form, 'currencyCode').trim().toUpperCase(),
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
                className="w-32 rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] text-faint">
                {t.sections.enforcement.fineCurrencyLabel}
              </span>
              <input
                name="currencyCode"
                required
                maxLength={3}
                minLength={3}
                className="w-24 rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text"
              />
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
            void submit('waive', { reason }, t.sections.enforcement.waived);
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
    </div>
  );
}

function Step({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-10 cursor-pointer items-center rounded-lg border px-3 py-1.5 text-[11.5px] lg:min-h-0 ${
        active
          ? 'border-gold/60 text-gold'
          : 'border-line text-muted hover:border-gold/50 hover:text-gold'
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
