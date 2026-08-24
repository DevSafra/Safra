'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { PartnerSuspension } from '@/lib/api';
import { ENFORCEMENT_REASON_MIN } from '@safra/contracts';

import { text } from '@/lib/form';
import { shortDateTime } from '@/lib/format';
import { apiErrorOf, fill, t } from '@/lib/strings';

/**
 * الإيقاف — suspending a partner, lifting it, and saying what it currently does.
 *
 * ## The banner is the point, not the button
 *
 * Bashar's policy (2026-08-24) is that suspension stops NEW trade and leaves existing guests alone:
 * listings leave search, no new bookings, payouts frozen — but confirmed bookings run to completion,
 * and the partner can still sign in and read why. Somebody opening a suspended partner's record is
 * usually deciding whether to lift it, and a pill saying «موقوف» does not tell them what is actually
 * blocked. So the banner states all four clauses.
 *
 * ## Two audiences, and the field that knows it
 *
 * `reason` is written FOR the partner — they can sign in and read it — and `notes` never leaves the
 * console. The API omits `notes` from the partner's payload rather than nulling it, and this
 * component renders it only inside the staff-only block, labelled as not visible to them. A field
 * with two audiences and one shape is what leaked a super admin's name through `actor_name` this
 * morning; the label is here so nobody has to remember which is which.
 *
 * ## Why lifting also asks for a reason
 *
 * It is an enforcement decision with a record, the same as imposing one. Six months later "why is
 * this partner trading again" is answerable from the trail or it is not answerable at all.
 */
export function PartnerSuspension({
  reference,
  suspension,
}: {
  readonly reference: string;
  readonly suspension: PartnerSuspension | null;
}) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(
    action: 'suspend' | 'unsuspend',
    body: { reason: string; notes?: string },
    success: string,
  ): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);
    setDone(null);

    try {
      const response = await fetch(
        `/api/partners/${encodeURIComponent(reference)}/${action}`,
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
      /* The banner above is server-rendered; the refresh is what re-reads it. */
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    }

    setBusy(false);
  }

  return (
    <div className="grid gap-3">
      {suspension ? (
        <div
          data-partner-suspended="true"
          className="rounded-lg border border-bad/40 bg-bad/10 p-3.5"
        >
          <p className="text-[13px] font-extrabold text-bad">
            {t.sections.enforcement.suspendedTitle}
          </p>

          {/* What suspension actually does — all four clauses, on the screen where it is lifted. */}
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-text2">
            {t.sections.enforcement.suspendedEffect}
          </p>

          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-[11px] text-faint">
                {t.sections.enforcement.suspendedReason}
              </dt>
              {/* Null only for a suspension predating the column — say so rather than blank. */}
              <dd className="mt-0.5 text-[12.5px] text-text">
                {suspension.reason ?? t.admin.noData}
              </dd>
            </div>

            <div className="min-w-0">
              <dt className="text-[11px] text-faint">
                {fill(t.sections.enforcement.suspendedSince, {
                  when: shortDateTime(suspension.since),
                })}
              </dt>
              <dd className="mt-0.5 text-[12.5px] text-text2">
                {suspension.by
                  ? fill(t.sections.enforcement.suspendedBy, { who: suspension.by })
                  : t.admin.systemActor}
              </dd>
            </div>
          </dl>

          {/*
            Staff-only, and labelled as such on the screen rather than only in a comment.

            The API omits this from the partner's own payload, so a console that renders it is not
            leaking — but the person TYPING it needs to know which of the two boxes the partner
            reads, and this is the same screen where they typed it.
          */}
          {suspension.notes ? (
            <div className="mt-3 rounded border border-line bg-field p-2.5">
              <p className="text-[11px] text-faint">
                {t.sections.enforcement.suspendedNotes}
                <span className="text-faint2">
                  {' · '}
                  {t.sections.enforcement.suspendedNotesHint}
                </span>
              </p>
              <p className="mt-0.5 text-[12px] text-text2">{suspension.notes}</p>
            </div>
          ) : null}
        </div>
      ) : null}

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

      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const reason = text(form, 'reason').trim();
          const notes = text(form, 'notes').trim();

          void submit(
            suspension ? 'unsuspend' : 'suspend',
            { reason, ...(notes ? { notes } : {}) },
            suspension
              ? t.sections.enforcement.unsuspended
              : t.sections.enforcement.suspended,
          );
          event.currentTarget.reset();
        }}
      >
        <label className="grid gap-1">
          <span className="text-[11px] text-faint">
            {suspension
              ? t.sections.enforcement.unsuspendReasonLabel
              : t.sections.enforcement.suspendReasonLabel}
          </span>
          {/*
            `minLength` matches the API's floor so the browser refuses first — the server still
            refuses, and this only saves a round trip and a translated error for a mistake the
            reader can see coming. No `dir`: a field a person types into follows the page.
          */}
          <textarea
            name="reason"
            required
            minLength={ENFORCEMENT_REASON_MIN}
            maxLength={2000}
            rows={2}
            className="rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text"
          />
          <span className="text-[10.5px] text-faint">
            {t.sections.enforcement.reasonHint}
          </span>
        </label>

        {/* Only when imposing: lifting a suspension has no private half worth keeping. */}
        {suspension ? null : (
          <label className="grid gap-1">
            <span className="text-[11px] text-faint">
              {t.sections.enforcement.notesLabel}
            </span>
            <textarea
              name="notes"
              maxLength={2000}
              rows={2}
              className="rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text"
            />
          </label>
        )}

        <button
          type="submit"
          disabled={busy}
          className={`inline-flex min-h-10 w-fit cursor-pointer items-center rounded-[9px] border px-4 py-2 text-[12.5px] font-bold disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0 ${
            suspension
              ? 'border-ok/50 text-ok hover:bg-ok/10'
              : 'border-bad/50 text-bad hover:bg-bad/10'
          }`}
        >
          {busy
            ? suspension
              ? t.sections.enforcement.unsuspending
              : t.sections.enforcement.suspending
            : suspension
              ? t.sections.enforcement.unsuspend
              : t.sections.enforcement.suspend}
        </button>
      </form>
    </div>
  );
}
