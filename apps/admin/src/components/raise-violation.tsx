'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { ENFORCEMENT_REASON_MIN, VIOLATION_KINDS } from '@safra/contracts';

import { text } from '@/lib/form';
import { apiErrorOf, label, t } from '@/lib/strings';

/**
 * تسجيل مخالفة — raising one by hand.
 *
 * ## Where the progression starts
 *
 * مخالفة ← إنذار ← غرامة ← إيقاف. This is the first step, and it is deliberately the only one that
 * creates anything: warning, fining and waiving all move a violation that already exists. The SLA
 * sweep raises its own without passing through here, which is why an operator raising one is
 * recording something the platform did not detect rather than duplicating something it did.
 *
 * ## The reason is written for the partner
 *
 * They can read it, and the twenty-character floor is the API's — a bar against «مخالفة» reaching a
 * real business owner as the entire explanation for a mark against their record. The form asks
 * before the server refuses, from the same constant the schema is built from.
 *
 * ## The booking is optional because some violations have none
 *
 * A stale calendar is not about one booking. Requiring a reference would push an operator into
 * attaching an unrelated one to satisfy the form, which is worse than the field being empty.
 */
export function RaiseViolation({ reference }: { reference: string }) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function raise(body: unknown): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);
    setDone(null);

    try {
      const response = await fetch(
        `/api/partners/${encodeURIComponent(reference)}/violations`,
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

      setDone(t.sections.enforcement.raised);
      setOpen(false);
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    }

    setBusy(false);
  }

  return (
    <div className="mb-4 grid gap-2">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
        >
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="rounded-lg border border-ok/40 bg-ok/10 p-3 text-sm text-ok">
          {done}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded-lg border border-gold/50 px-4 py-2 text-[12.5px] font-bold text-gold hover:bg-gold/10 lg:min-h-0"
      >
        {t.sections.enforcement.raise}
      </button>

      {open ? (
        <form
          className="grid gap-2 rounded-lg border border-line bg-card p-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const booking = text(form, 'bookingReference').trim();

            void raise({
              kind: text(form, 'kind'),
              reason: text(form, 'reason').trim(),
              ...(booking ? { bookingReference: booking } : {}),
            });
          }}
        >
          <label className="grid gap-1">
            <span className="text-[11px] text-faint">
              {t.sections.enforcement.kindLabel}
            </span>
            {/*
              No default selection. The kind decides what the partner is told they did, so a select
              arriving pre-filled invites recording the wrong offence against a real business.
            */}
            <select
              name="kind"
              required
              defaultValue=""
              className="cursor-pointer rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text"
            >
              <option value="" disabled>
                {t.sections.enforcement.pickViolationKind}
              </option>
              {VIOLATION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {label(t.enums.violationKind, kind)}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] text-faint">
              {t.sections.enforcement.violationReasonLabel}
            </span>
            {/* No `dir`: a field a person types into follows the page (docs/i18n.md §9). */}
            <textarea
              name="reason"
              required
              minLength={ENFORCEMENT_REASON_MIN}
              maxLength={2000}
              rows={2}
              className="rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text"
            />
            <span className="text-[10.5px] text-faint">
              {t.sections.enforcement.reasonHint}
            </span>
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] text-faint">
              {t.sections.enforcement.bookingLabel}
            </span>
            <input
              name="bookingReference"
              maxLength={64}
              className="w-56 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text"
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded-lg border border-gold/50 px-4 py-2 text-[12px] font-bold text-gold hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
          >
            {busy ? t.sections.enforcement.raising : t.sections.enforcement.raise}
          </button>
        </form>
      ) : null}
    </div>
  );
}
