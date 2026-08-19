'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { t } from '@/lib/strings';

type Action = 'contact' | 'accept' | 'reject' | 'resend';

/**
 * The decisions on a partnership request (Bashar, 2026-08-19).
 *
 * ## Which buttons exist is decided by the STATUS, not by hiding them
 *
 * A decided request offers nothing but «إعادة إرسال الدعوة», because the API refuses everything
 * else — and a button that always answers «تعذّر تنفيذ الإجراء» teaches an operator to distrust
 * the screen rather than to read it. The API is still the authority: this is which of the allowed
 * actions to OFFER, not which are permitted.
 *
 * ## Accepting says what it will do before it does it
 *
 * It creates an account and mails an invitation to an address somebody typed into a public form.
 * The hint above the button says exactly that, including the part operators most need to know —
 * that no password is ever mailed — because the alternative is somebody promising a partner a
 * password on the phone.
 *
 * ## A rejection's reason is READ BY THE APPLICANT
 *
 * It goes into the email verbatim. Said plainly above the field, because internal shorthand
 * («يبدو مشبوهاً») written into a box that looks like an internal note is the mistake this
 * warning exists to prevent.
 */
export function ApplicationActions({
  reference,
  status,
}: {
  readonly reference: string;
  readonly status: string;
}) {
  const router = useRouter();

  const [open, setOpen] = useState<Action | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decided = status === 'accepted' || status === 'rejected';
  /* A reason is required to reject and to record a call; accepting may be wordless. */
  const needsNotes = open === 'contact' || open === 'reject';
  const ready = !busy && (!needsNotes || notes.trim().length >= 2);

  async function submit(action: Action): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/partner-applications/${encodeURIComponent(reference)}/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(notes.trim() ? { notes: notes.trim() } : {}),
        },
      );

      if (!response.ok) {
        setError(t.sections.partnerApplications.actionFailed);

        return;
      }

      setOpen(null);
      setNotes('');
      /* The server component re-reads the row, so the history and the new status appear. */
      router.refresh();
    } catch {
      setError(t.sections.partnerApplications.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {decided ? null : (
          <>
            <Trigger
              onClick={() => setOpen(open === 'contact' ? null : 'contact')}
              active={open === 'contact'}
            >
              {t.sections.partnerApplications.contactAction}
            </Trigger>
            <Trigger
              onClick={() => setOpen(open === 'accept' ? null : 'accept')}
              active={open === 'accept'}
              tone="ok"
            >
              {t.sections.partnerApplications.acceptAction}
            </Trigger>
            <Trigger
              onClick={() => setOpen(open === 'reject' ? null : 'reject')}
              active={open === 'reject'}
              tone="bad"
            >
              {t.sections.partnerApplications.rejectAction}
            </Trigger>
          </>
        )}

        {status === 'accepted' ? (
          <Trigger
            onClick={() => setOpen(open === 'resend' ? null : 'resend')}
            active={open === 'resend'}
          >
            {t.sections.partnerApplications.resendAction}
          </Trigger>
        ) : null}
      </div>

      {open ? (
        <div className="grid gap-2 rounded-[10px] border border-line bg-field p-3">
          <p className="text-[11.5px] leading-relaxed text-muted">
            {open === 'contact'
              ? t.sections.partnerApplications.contactHint
              : open === 'accept'
                ? t.sections.partnerApplications.acceptHint
                : open === 'reject'
                  ? t.sections.partnerApplications.rejectHint
                  : t.sections.partnerApplications.resendHint}
          </p>

          {open === 'resend' ? null : (
            <label className="grid gap-1">
              <span className="text-[11.5px] text-faint">
                {t.sections.partnerApplications.notes}
              </span>
              {/*
                No `dir` — a field a person types into follows the page, which here is RTL
                (docs/i18n.md §9). The notes are Arabic prose in every case that matters.
              */}
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                maxLength={2000}
                className="rounded-[9px] border border-line bg-card px-3 py-2 text-[12.5px] text-text"
              />
            </label>
          )}

          {error ? <p className="text-[11.5px] text-bad">{error}</p> : null}

          <button
            type="button"
            disabled={!ready}
            onClick={() => void submit(open)}
            className="min-h-10 w-fit cursor-pointer rounded-lg bg-[linear-gradient(135deg,#F0CB7C,#C4923E)] px-5 text-[12.5px] font-extrabold text-[#241A05] disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0 lg:py-2"
          >
            {busy ? t.table.working : t.table.confirm}
          </button>

          {needsNotes && notes.trim().length < 2 ? (
            <p className="text-[11px] text-faint">
              {t.sections.partnerApplications.notesRequired}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Trigger({
  children,
  onClick,
  active,
  tone,
}: {
  readonly children: React.ReactNode;
  readonly onClick: () => void;
  readonly active: boolean;
  readonly tone?: 'ok' | 'bad';
}) {
  const border =
    tone === 'ok'
      ? 'border-ok text-ok'
      : tone === 'bad'
        ? 'border-bad text-bad'
        : 'border-line text-muted';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={`min-h-10 cursor-pointer rounded-lg border px-4 text-[12.5px] transition-colors lg:min-h-0 lg:py-2 ${border} ${
        active ? 'bg-field' : ''
      }`}
    >
      {children}
    </button>
  );
}
