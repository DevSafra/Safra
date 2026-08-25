'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { text } from '@/lib/form';
import { apiErrorOf, fill, label, t } from '@/lib/strings';

/** One note as the API renders it — the author is a staff address or a role, never a customer. */
export type BookingNote = {
  note: string;
  author: string | null;
  createdAt: string;
};

/**
 * Staff notes on a booking (§9.4), never shown to the customer or the partner.
 *
 * ## Appended, never edited
 *
 * `booking_internal_notes` is append-only by trigger, so there is no edit control here and there
 * could not be one. `bookings.internal_notes` — the single text column this replaces — would have
 * let the second writer erase the first, which is the defect `partner_application_contacts` was
 * created to fix on a different screen (`O-partner-7`, 2026-08-20). A note that was wrong is
 * corrected by writing another one, and the hint says so before anybody looks for a pencil.
 *
 * ## Oldest first
 *
 * The section is a history and reads downwards: what was learnt, then what was learnt next. The
 * API orders it; this renders what it is given.
 */
export function BookingNotes({
  reference,
  notes,
}: {
  reference: string;
  notes: readonly BookingNote[];
}) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function add(note: string, form: HTMLFormElement): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);
    setDone(null);

    try {
      const response = await fetch(
        `/api/bookings/${encodeURIComponent(reference)}/notes`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note }),
        },
      );

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);

        /* A CODE resolved locally — never the English `message`, which travels for logs. */
        setError(apiErrorOf(payload));
        setBusy(false);

        return;
      }

      setDone(t.sections.bookingDetail.noteAdded);
      /*
        Cleared only on success, and that is deliberate.

        A refusal leaves what was typed in the box: the note is prose somebody composed, and
        emptying the field on a 400 makes them write it again to find out what was wrong with it.
      */
      form.reset();
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    }

    setBusy(false);
  }

  return (
    <section>
      <h2 className="mb-1 text-lg text-text">{t.sections.bookingDetail.notes}</h2>
      {/* Who does NOT see it — the only thing worth knowing before typing. */}
      <p className="mb-3 text-[11.5px] text-faint">
        {t.sections.bookingDetail.notesHint}
      </p>

      {notes.length === 0 ? (
        <p className="text-sm text-faint">{t.sections.bookingDetail.noNotes}</p>
      ) : (
        <ol className="grid gap-2">
          {notes.map((entry) => (
            <li
              key={`${entry.createdAt}-${entry.note.slice(0, 24)}`}
              /*
                Addressable, the way `data-status-pill` makes every status findable and nothing
                else. A browser test that counted `li` elements would also count the timeline's.
              */
              data-note
              className="rounded-lg border border-line bg-card px-4 py-3"
            >
              {/* `whitespace-pre-wrap`: a note is prose somebody laid out, including its breaks. */}
              <p className="text-sm whitespace-pre-wrap text-text">{entry.note}</p>
              <p className="mt-1 text-xs text-faint">
                {fill(t.sections.bookingDetail.noteBy, {
                  /*
                    Null when the account that wrote it has since been removed — the column is
                    nullable so the note survives its author. «موظف» is the honest remainder: a
                    staff member wrote this and we no longer have their name.
                  */
                  who: entry.author ?? label(t.enums.actorType, 'staff'),
                  when: entry.createdAt.slice(0, 16).replace('T', ' '),
                })}
              </p>
            </li>
          ))}
        </ol>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-[12px] text-bad">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="mt-3 text-[12px] text-ok">
          {done}
        </p>
      ) : null}

      <form
        className="mt-3 grid gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;

          void add(text(new FormData(form), 'note').trim(), form);
        }}
      >
        <label className="grid gap-1">
          <span className="text-[11px] text-faint">
            {t.sections.bookingDetail.noteLabel}
          </span>
          {/* No `dir`: a field a person types into follows the page (docs/i18n.md §9). */}
          <textarea
            name="note"
            required
            minLength={2}
            maxLength={2000}
            rows={3}
            disabled={busy}
            className="rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text disabled:cursor-not-allowed"
          />
          <span className="text-[10.5px] text-faint">
            {t.sections.bookingDetail.noteHint}
          </span>
        </label>

        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded-lg border border-gold/50 px-4 py-2 text-[12.5px] font-bold text-gold hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
        >
          {busy ? t.sections.bookingDetail.addingNote : t.sections.bookingDetail.addNote}
        </button>
      </form>
    </section>
  );
}
