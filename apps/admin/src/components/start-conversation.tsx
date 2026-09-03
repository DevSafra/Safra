'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { TableToolbar } from '@/components/table-toolbar';
import { t, apiErrorOf } from '@/lib/strings';

/** The three things SAFRA can address a thread to. */
const RECIPIENTS = ['customer', 'partner', 'booking'] as const;

type Recipient = (typeof RECIPIENTS)[number];

function isRecipient(value: string | undefined): value is Recipient {
  return RECIPIENTS.includes((value ?? '') as Recipient);
}

/** The shape to type, per recipient — the placeholder is the only hint of the prefix. */
function referencePlaceholder(to: Recipient): string {
  const c = t.sections.messages;

  if (to === 'partner') return c.composeReferencePartner;
  if (to === 'booking') return c.composeReferenceBooking;

  return c.composeReferenceCustomer;
}

/**
 * «محادثة جديدة» — SAFRA writing first.
 *
 * ## The gap this closes
 *
 * `INSERT INTO conversations` had two callers and neither was staff: a customer or partner opening
 * a ticket, and a dispute opening its own thread. So الرسائل was a reply-only inbox — an operator
 * could answer somebody who had written in and could not write to anybody. Bashar asked how to
 * message a customer, a partner, or both at once (2026-08-29); there was no way to do any of it.
 *
 * ## «Both at once» is a BOOKING
 *
 * Not two threads, and not a recipient list. The three-party record — customer, SAFRA, host — hangs
 * off the booking, because that is the thing they are both party to and the thing a disagreement
 * about a night refers back to. The schema has said so since the first migration; nothing could
 * write it until now.
 *
 * ## Collapsed until asked for
 *
 * A form permanently above the inbox would push the queue down the page, and the queue is what this
 * screen is for. It opens by itself when a link arrives carrying a recipient — «مراسلة» on a
 * customer, a partner or a booking — so the common path is one press from the record.
 *
 * ## It owns the bar, so the control can sit IN it
 *
 * Bashar asked (2026-08-30) for «محادثة جديدة» beside the search rather than under it. The two
 * halves — a trigger on the bar's line and a panel at the table's full width — are `TableToolbar`'s
 * own `end` and `below` slots, and they must share one piece of state, so this component renders
 * the bar instead of sitting beneath it. `end` is `ms-auto`, which on an Arabic screen is the
 * visual LEFT; `below` exists because a `w-full` panel inside `end` resolves to its content width
 * and lands in a third of the row.
 */
export function StartConversation({
  action,
  query,
  size,
  placeholder,
  defaultTo,
  defaultReference,
}: {
  /** The search form's target and current state — passed straight through to `TableToolbar`. */
  readonly action: string;
  readonly query: string | undefined;
  readonly size: number;
  readonly placeholder: string;
  readonly defaultTo?: string | undefined;
  readonly defaultReference?: string | undefined;
}) {
  const router = useRouter();
  const c = t.sections.messages;

  /* Arriving from «مراسلة» means the operator has already decided to write. */
  const prefilled = isRecipient(defaultTo) && (defaultReference ?? '') !== '';

  const [open, setOpen] = useState(prefilled);
  const [to, setTo] = useState<Recipient>(
    isRecipient(defaultTo) ? defaultTo : 'customer',
  );
  const [reference, setReference] = useState(defaultReference ?? '');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = reference.trim() !== '' && body.trim() !== '';

  async function send(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, reference: reference.trim(), body: body.trim() }),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setError(apiErrorOf(payload));

        return;
      }

      /*
        Straight into the thread it landed in — which may be one that was already open, because a
        second message to the same party continues the conversation rather than making a duplicate
        row nobody can tell apart from the first.
      */
      const created =
        typeof payload === 'object' && payload !== null && 'reference' in payload
          ? String(payload.reference)
          : '';

      if (created) router.push(`/messages/${encodeURIComponent(created)}`);
      else router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-[rgba(var(--goldA),0.4)] px-4.5 py-2 text-xs font-bold text-gold-ink transition-colors hover:bg-[rgba(var(--goldA),0.08)] lg:min-h-0"
    >
      {c.compose}
    </button>
  );

  const form = (
    <div className="grid gap-3 rounded-card border border-line bg-field p-3.5">
      <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
        {c.composeTo}
        <select
          name="to"
          value={to}
          onChange={(event) => setTo(event.target.value as Recipient)}
          className="cursor-pointer rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-text"
        >
          <option value="customer">{c.composeToCustomer}</option>
          <option value="partner">{c.composeToPartner}</option>
          <option value="booking">{c.composeToBooking}</option>
        </select>
      </label>

      {/*
        No `dir` at all — the page's own direction.

        A reference is a Latin RUN inside an Arabic field, and the bidi algorithm lays it out
        correctly without being told. `dir="ltr"` would move the field's START edge and put the
        label on one side and the caret on the other.
      */}
      <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
        {c.composeReference}
        <input
          name="reference"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          /* The prefix is the whole hint: it changes with the recipient above it. */
          placeholder={referencePlaceholder(to)}
          className="rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-text placeholder:text-faint"
        />
        <span className="text-[10.5px] font-normal text-faint2">
          {c.composeReferenceHint}
        </span>
      </label>

      <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
        {c.composeBody}
        <textarea
          name="body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          placeholder={c.composeBodyPlaceholder}
          className="rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] leading-relaxed text-text placeholder:text-faint"
        />
      </label>

      <p className="text-[10.5px] leading-relaxed text-faint2">{c.composeNote}</p>

      {error ? <p className="text-[11px] font-semibold text-bad">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !ready}
          onClick={() => void send()}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-gold px-4.5 py-2 text-xs font-bold text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
        >
          {busy ? c.composeSending : c.composeSend}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-4 py-2 text-xs font-bold text-muted transition-colors hover:text-text lg:min-h-0"
        >
          {c.composeCancel}
        </button>
      </div>
    </div>
  );

  return (
    <TableToolbar
      action={action}
      query={query}
      size={size}
      placeholder={placeholder}
      end={trigger}
      below={open ? form : null}
    />
  );
}
