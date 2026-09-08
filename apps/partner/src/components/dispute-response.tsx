'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { codeOfResponse, refusalFor } from '@/lib/refusal';
import { t } from '@/lib/strings';

/**
 * The box a partner writes their side of a dispute into (finding 223).
 *
 * Bashar, 2026-09-08: *«I do not want SAFRA deciding disputes while only one side is able to
 * participate in the process.»* This is the participating.
 *
 * ## It says what happens to the words BEFORE they are typed
 *
 * Two things a person needs to know before writing an account of a bad night, both above the box:
 * that it is read before the decision, and that it cannot be edited afterwards. The second is not
 * a warning for its own sake — the table is append-only by trigger, so «I'll fix it later» is not
 * available and telling somebody that after the fact would be worse than not having said it.
 *
 * ## A redacted response says so
 *
 * `redactContactDetails` runs server-side, so a partner who pastes the guest's number gets it
 * removed. Silently would be wrong — they would believe SAFRA has a phone number it does not have.
 * The success line changes when anything was taken out, which is the honest report of what was
 * stored.
 */
export function DisputeResponse({ reference }: { readonly reference: string }) {
  const router = useRouter();
  const c = t.disputes;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ redactedCount: number } | null>(null);

  async function submit(body: string): Promise<void> {
    if (busy) return;

    /*
      Checked here as well as at both boundaries, and for a different reason than they check it:
      this one exists so somebody who typed three words is told immediately rather than after a
      round trip that ends in a generic refusal.
    */
    if (body.trim().length < 10) {
      setError(c.respondTooShort);

      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/disputes/${encodeURIComponent(reference)}/responses`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: body.trim() }),
        },
      );

      if (!response.ok) {
        setError(refusalFor(await codeOfResponse(response)) ?? c.respondFailed);

        return;
      }

      const payload: unknown = await response.json().catch(() => null);
      const redactedCount =
        typeof payload === 'object' && payload !== null
          ? Number((payload as Record<string, unknown>)['redactedCount'] ?? 0)
          : 0;

      setSent({ redactedCount: Number.isFinite(redactedCount) ? redactedCount : 0 });
      /* The page is server-rendered, so the new response appears by re-reading the case file. */
      router.refresh();
    } catch {
      setError(t.dashboard.unreachable);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p
        role="status"
        className="rounded-lg border border-ok/40 bg-ok/10 p-3 text-[14px] text-text"
      >
        {sent.redactedCount > 0 ? c.respondRedacted : c.respondSent}
      </p>
    );
  }

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const value = new FormData(event.currentTarget).get('body');
        void submit(typeof value === 'string' ? value : '');
      }}
    >
      <label htmlFor="dispute-response" className="text-[14px] text-muted">
        {c.respondLabel}
      </label>
      {/*
        No `dir` at all, so the field takes the page's own direction — the standing rule for
        anything a person types. An Arabic account on an Arabic screen starts on the right.
      */}
      <textarea
        id="dispute-response"
        name="body"
        rows={5}
        required
        minLength={10}
        maxLength={4000}
        className="rounded-lg border border-line bg-field px-3 py-2 text-[14px] text-text"
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="min-h-10 cursor-pointer rounded-lg border-none bg-[linear-gradient(135deg,#8FD9A8,#4F9E6B)] px-4 py-2 text-[14px] font-extrabold text-[#0A2013] transition-transform duration-150 ease-out-strong active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none lg:min-h-0"
        >
          {busy ? c.respondSending : c.respondSubmit}
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-[13px] text-bad">
          {error}
        </p>
      ) : null}
    </form>
  );
}
