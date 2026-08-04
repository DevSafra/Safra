'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import type { EmergencyState } from '@/lib/api';
import { AR, apiError } from '@/lib/strings';

/**
 * The Emergency Mode control (EC-009, design handoff §8.3).
 *
 * ## Why this one is a client component when the rest of the console is not
 *
 * It is the console's only genuinely stateful form: the target list depends on the chosen scope,
 * and the confirm step must read the operator's own selections back to them before the button
 * arms. That is interaction, not display.
 *
 * ## Two steps, deliberately
 *
 * The design has a single "تفعيل وضع الطوارئ" button. This adds a confirmation that restates
 * exactly what is about to happen, because the action stops the platform taking money in a
 * region and may broadcast to every customer with an upcoming booking there. A misclick with no
 * confirmation is not a recoverable mistake — the broadcast cannot be unsent. This is an
 * addition to the design, documented as such, on the grounds that the handoff specifies the
 * control's appearance and not its safety interlocks.
 */
export function EmergencyForm({ scopes }: { scopes: EmergencyState['scopes'] }) {
  const router = useRouter();
  const formId = useId();

  const [scope, setScope] = useState<'city' | 'country'>('city');
  const [scopeRef, setScopeRef] = useState('');
  const [reason, setReason] = useState('');
  const [flags, setFlags] = useState({
    stopBookings: true,
    waiveFines: false,
    broadcast: false,
    suspendSla: false,
  });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets = scope === 'city' ? scopes.cities : scopes.countries;
  const selected = targets.find((target) => target.ref === scopeRef);

  /*
    The button cannot arm without a target, a reason of at least ten characters and at least one
    flag. An "emergency" that changes nothing is a false audit entry, and a reason is what makes
    the entry reviewable a month later — so both are required client-side as well as server-side.
  */
  const ready =
    scopeRef !== '' && reason.trim().length >= 10 && Object.values(flags).some(Boolean);

  async function activate(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/emergency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, scopeRef, flags, reason: reason.trim() }),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        /*
          The narrowing already proves `message` exists; no assertion is needed and the linter
          rightly refuses one. `String()` handles the case where the API sends an array of
          validation messages rather than a single string.
        */
        const message =
          typeof payload === 'object' && payload !== null && 'message' in payload
            ? String(payload.message)
            : null;

        setError(apiError(message));
        setBusy(false);

        return;
      }

      setConfirming(false);
      setReason('');
      // The banner and history live on the server component, so a refresh is the update.
      router.refresh();
    } catch {
      setError(AR.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-[640px] rounded-[15px] border border-[rgba(var(--badA),0.5)] bg-card p-5.5">
      <h2 className="text-[15px] font-extrabold text-bad">
        {AR.sections.emergency.title}
      </h2>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
        {AR.sections.emergency.hint}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
          {AR.sections.emergency.scope}
          <select
            value={scope}
            onChange={(event) => {
              setScope(event.target.value === 'country' ? 'country' : 'city');
              // The previous target belongs to the other list; keeping it would submit a
              // city slug as a country code.
              setScopeRef('');
              setConfirming(false);
            }}
            className="cursor-pointer rounded-[9px] border border-line bg-field px-3 py-2.5 text-[13px] text-text"
          >
            <option value="city">{AR.sections.emergency.scopeCity}</option>
            <option value="country">{AR.sections.emergency.scopeCountry}</option>
          </select>
        </label>

        <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
          {AR.sections.emergency.target}
          <select
            value={scopeRef}
            onChange={(event) => {
              setScopeRef(event.target.value);
              setConfirming(false);
            }}
            className="cursor-pointer rounded-[9px] border border-line bg-field px-3 py-2.5 text-[13px] text-text"
          >
            <option value="">—</option>
            {targets.map((target) => (
              <option key={target.ref} value={target.ref}>
                {target.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="mt-4 grid gap-2.5 text-[13px] text-text2">
        <legend className="sr-only">{AR.sections.emergency.title}</legend>

        {(
          [
            ['stopBookings', AR.sections.emergency.stopBookings],
            ['waiveFines', AR.sections.emergency.waiveFines],
            ['broadcast', AR.sections.emergency.broadcast],
            ['suspendSla', AR.sections.emergency.suspendSla],
          ] as const
        ).map(([key, text]) => (
          <label key={key} className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={flags[key]}
              onChange={(event) => {
                setFlags((current) => ({ ...current, [key]: event.target.checked }));
                setConfirming(false);
              }}
              className="size-[15px] cursor-pointer accent-[#C24444]"
            />
            {text}
          </label>
        ))}
      </fieldset>

      {/* The broadcast has no send path yet; saying so beats a checkbox that quietly does nothing. */}
      {flags.broadcast ? (
        <p className="mt-2.5 text-[11px] leading-relaxed text-warn">
          {AR.sections.emergency.broadcastPending}
        </p>
      ) : null}

      <label className="mt-4 grid gap-1.5 text-[11.5px] font-semibold text-muted">
        {AR.sections.emergency.reason}
        <textarea
          id={`${formId}-reason`}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setConfirming(false);
          }}
          rows={2}
          maxLength={500}
          className="rounded-[9px] border border-line bg-field px-3 py-2.5 text-[13px] text-text"
        />
        <span className="text-[10.5px] font-normal text-faint2">
          {AR.sections.emergency.reasonHint}
        </span>
      </label>

      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-bad">
          {error}
        </p>
      ) : null}

      {confirming && selected ? (
        <div className="mt-4 rounded-xl border border-bad bg-[rgba(var(--badA),0.12)] p-3.5">
          {/*
            The confirmation restates the operator's own selections rather than saying "are you
            sure?". A generic prompt trains people to click through it; this one is only
            answerable by reading it.
          */}
          <p className="text-[12.5px] font-bold text-bad">{selected.name}</p>
          <ul className="mt-1.5 grid gap-0.5 text-[11.5px] text-text2">
            {flags.stopBookings ? <li>• {AR.sections.emergency.stopBookings}</li> : null}
            {flags.waiveFines ? <li>• {AR.sections.emergency.waiveFines}</li> : null}
            {flags.broadcast ? <li>• {AR.sections.emergency.broadcast}</li> : null}
            {flags.suspendSla ? <li>• {AR.sections.emergency.suspendSla}</li> : null}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2.5">
        <button
          type="button"
          disabled={!ready || busy}
          onClick={() => {
            if (confirming) {
              void activate();
            } else {
              setConfirming(true);
            }
          }}
          className="cursor-pointer rounded-[9px] bg-bad px-6 py-3 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {confirming ? AR.sections.emergency.activate : AR.admin.handle}
        </button>

        {confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="cursor-pointer rounded-[9px] border border-line px-6 py-3 text-[13px] text-muted"
          >
            {AR.login.useDifferentAccount}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Stands an active declaration down. Separate because it appears in the banner too. */
export function DeactivateButton({ id, scopeName }: { id: string; scopeName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function deactivate(): Promise<void> {
    setBusy(true);

    await fetch(`/api/emergency/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      /*
        A fixed reason, because the operator has already confirmed the scope by clicking the
        button on that specific banner. The API requires ten characters; inventing a prompt here
        would add friction to STOPPING an emergency, which is the wrong direction to add it.
      */
      body: JSON.stringify({ reason: `Deactivated from the console for ${scopeName}` }),
    });

    setBusy(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void deactivate()}
      className="ms-auto cursor-pointer rounded-lg bg-bad px-4.5 py-1.75 text-xs font-extrabold whitespace-nowrap text-white disabled:opacity-50"
    >
      {AR.sections.emergency.deactivate}
    </button>
  );
}
