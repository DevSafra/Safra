'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Recording a sanctions screening result (ADR 0002, §8.1).
 *
 * **This screen does not perform a check.** Item 120 has no provider integration, so
 * what happens today is that a human searches the EU consolidated list themselves and
 * records what they found. The wording says exactly that, because a panel that looked
 * automated would let a reviewer believe a check had run when none had — and the
 * whole point of the gate is that somebody actually looked.
 *
 * A German entity is bound by EU sanctions law. Regulation (EU) 2025/1098 lifted the
 * economic measures in 2025, but asset freezes on persons tied to the former al-Assad
 * regime were renewed to 2027-06-01, so screening is a legal obligation rather than a
 * precaution.
 */
export function ScreeningPanel({
  reference,
  screenedAt,
  result,
}: {
  reference: string;
  screenedAt: string | null;
  result: unknown;
}) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  async function record(matched: boolean, notes: string) {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/partners/${reference}/screening`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          /**
           * Named for what actually happened. When item 120 lands and a provider is
           * called, its own name goes here instead — and the two are then
           * distinguishable in the record, which is the point of storing it.
           */
          provider: 'manual_eu_consolidated_list',
          matched,
          details: { checkedBy: 'staff', notes, list: 'EU consolidated list' },
        }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setError(messageOf(body) ?? 'Could not record the screening.');
        setBusy(false);
        return;
      }

      setRecording(false);
      router.refresh();
      setBusy(false);
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  }

  const matched = isMatched(result);

  return (
    <div className="rounded-lg border border-line bg-card p-4">
      {screenedAt ? (
        <div>
          <p className={`text-sm ${matched ? 'text-bad' : 'text-good'}`}>
            {matched
              ? 'A possible match was recorded — do not approve without escalating.'
              : 'Screened, no match recorded.'}
          </p>
          <p className="mt-1 text-xs text-faint">Recorded {screenedAt.slice(0, 10)}</p>

          {/*
            The raw provider payload, verbatim. If a match is ever disputed, what the
            screener actually saw is the only useful evidence — a summary would be our
            interpretation of it.
          */}
          {result ? (
            <pre className="mt-3 max-h-40 overflow-auto rounded border border-line bg-field p-3 text-xs text-muted">
              {JSON.stringify(result, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-gold">
          Not screened. A partner cannot be verified until a screening result is recorded.
        </p>
      )}

      <p className="mt-3 text-xs text-faint">
        SAFRA does not yet call a screening provider. Search the EU consolidated list for
        the legal name and the signing person, then record what you found.
      </p>

      {error ? (
        <p role="alert" className="mt-3 text-xs text-bad">
          {error}
        </p>
      ) : null}

      {recording ? (
        <form
          className="mt-3 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const notes = form.get('notes');
            void record(
              form.get('matched') === 'yes',
              typeof notes === 'string' ? notes : '',
            );
          }}
        >
          <label htmlFor="notes" className="text-xs text-muted">
            What did you search, and what came back?
          </label>
          <textarea
            id="notes"
            name="notes"
            required
            rows={2}
            className="rounded-lg border border-line bg-field px-3 py-2 text-sm text-text"
          />

          <fieldset className="grid gap-1.5">
            <legend className="text-xs text-muted">Result</legend>
            <label className="flex items-center gap-2 text-sm text-text">
              <input
                type="radio"
                name="matched"
                value="no"
                defaultChecked
                className="accent-gold"
              />
              No match
            </label>
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="radio" name="matched" value="yes" className="accent-gold" />
              Possible match — needs escalation
            </label>
          </fieldset>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Record result'}
            </button>
            <button
              type="button"
              onClick={() => setRecording(false)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setRecording(true)}
          className="mt-3 rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-gold/50 hover:text-gold"
        >
          {screenedAt ? 'Record a new screening' : 'Record screening result'}
        </button>
      )}
    </div>
  );
}

function isMatched(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as Record<string, unknown>)['matched'] === true
  );
}

function messageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('message' in body)) return null;

  const { message } = body;
  return typeof message === 'string' ? message : null;
}
