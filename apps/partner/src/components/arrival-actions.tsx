'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { fill, t } from '@/lib/strings';
import type { PartnerArrival } from '@/lib/api';

/**
 * The one control on an arrival row: admit the guest, or take it back.
 *
 * ## Undo is offered, and it is not a safety net for a dangerous action
 *
 * Checking in moves no money — the payout is driven by completion — so a wrong press costs a wrong
 * row and nothing else. Without an undo the only route back is a support ticket, and a person who
 * knows that hesitates before pressing, which defeats a screen whose whole purpose is one press at
 * a busy counter. The confirmation exists for a different reason: this is the SECOND press on the
 * same row, and somebody who has just checked a guest in is not expecting the button underneath
 * their finger to have changed meaning.
 *
 * ## A refusal here means the row is stale, not that the press failed
 *
 * The API bounds both moves by status in the `WHERE` — only `confirmed → checked_in` and only
 * `checked_in → confirmed` — so a second press, a cancelled booking and another business's
 * reference all answer 404. From the desk that means one thing: what is on screen is no longer
 * what is in the database. «حدّث الصفحة» is the honest instruction; "try again" would be a lie.
 */
export function ArrivalActions({ arrival }: { arrival: PartnerArrival }) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkedIn = arrival.status === 'checked_in';

  async function send(action: 'check-in' | 'undo-check-in'): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/arrivals/${encodeURIComponent(arrival.reference)}/${action}`,
        { method: 'POST' },
      );

      if (response.ok) {
        setBusy(false);
        router.refresh();

        return;
      }

      setError(response.status === 404 ? t.arrivals.gone : t.arrivals.failed);
      setBusy(false);
    } catch {
      setError(t.arrivals.failed);
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {checkedIn ? (
          <>
            <span className="rounded-full border border-sky bg-sky/15 px-2.5 py-0.5 text-[11px] font-bold text-sky">
              {t.arrivals.checkedIn}
            </span>
            <button
              type="button"
              disabled={busy}
              aria-label={fill(t.arrivals.undoLabel, { name: arrival.guestName })}
              onClick={() => {
                if (
                  window.confirm(
                    fill(t.arrivals.undoConfirm, { name: arrival.guestName }),
                  )
                ) {
                  void send('undo-check-in');
                }
              }}
              className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-muted transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t.arrivals.undo}
            </button>
          </>
        ) : (
          /*
            The primary action on the busiest screen in the portal, so it is the gold button and it
            is the only one on the row. `min-h-10` below `lg`: this is pressed on a phone at a
            counter, where the input is a finger.
          */
          <button
            type="button"
            disabled={busy}
            aria-label={fill(t.arrivals.checkInLabel, { name: arrival.guestName })}
            onClick={() => void send('check-in')}
            className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-gold px-4 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0 lg:py-2"
          >
            {busy ? t.arrivals.working : t.arrivals.checkIn}
          </button>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-[12.5px] text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
