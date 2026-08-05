'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { t, apiError } from '@/lib/strings';

/**
 * A staff reply into a three-party thread.
 *
 * ## The redaction warning is shown BEFORE sending
 *
 * The API strips contact details on the way in, staff included. Rather than let an agent discover
 * that after the fact, the form detects the same shapes and says so while they are typing — so the
 * choice to send anyway is a choice, and nobody is surprised by a mask in their own message.
 *
 * The detection here is a HINT, deliberately duplicated rather than shared: the authoritative rule
 * lives at the write boundary in the API, where a client that skipped this form cannot bypass it.
 */
const HINT_PATTERNS = [
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/,
  /(?<![A-Za-z\d-])(?:\+?\d[\d\s().-]{5,}\d)(?![\d-])/,
  /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|net|org|me|io|co)\b/i,
];

export function ReplyForm({ reference }: { reference: string }) {
  const router = useRouter();

  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const willRedact = HINT_PATTERNS.some((pattern) => pattern.test(body));

  async function send(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/conversations/${encodeURIComponent(reference)}/reply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: body.trim(), internal }),
        },
      );

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const message =
          typeof payload === 'object' && payload !== null && 'message' in payload
            ? String(payload.message)
            : null;

        setError(apiError(message));

        return;
      }

      setBody('');
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2.5">
      <label className="grid gap-1.5">
        <span className="sr-only">{t.sections.messages.replyPlaceholder}</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          maxLength={4000}
          placeholder={t.sections.messages.replyPlaceholder}
          className="rounded-[9px] border border-line bg-field px-3 py-2.5 text-[12.5px] leading-relaxed text-text placeholder:text-faint"
        />
      </label>

      <label className="flex cursor-pointer items-center gap-2.5 text-[12px] text-text2">
        <input
          type="checkbox"
          checked={internal}
          onChange={(event) => setInternal(event.target.checked)}
          className="size-[15px] cursor-pointer accent-warn"
        />
        {t.sections.messages.replyInternal}
      </label>

      {willRedact ? (
        <p className="text-[11px] text-warn">{t.sections.messages.redactionNote}</p>
      ) : null}

      {error ? (
        <p role="alert" className="text-[11.5px] text-bad">
          {error}
        </p>
      ) : null}

      <div>
        <button
          type="button"
          disabled={body.trim().length === 0 || busy}
          onClick={() => void send()}
          className="cursor-pointer rounded-[9px] bg-[linear-gradient(135deg,#F0CB7C,#C4923E)] px-5 py-2 text-[12.5px] font-extrabold text-[#241A05] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? t.sections.messages.replying : t.sections.messages.reply}
        </button>
      </div>
    </div>
  );
}
