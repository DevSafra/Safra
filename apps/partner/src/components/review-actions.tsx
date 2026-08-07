'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { t } from '@/lib/strings';

/**
 * الرد and إبلاغ — the only two things a partner may do about a review (P-006).
 *
 * ## What this component cannot offer, structurally
 *
 * There is no delete. Not hidden behind a permission, not disabled — absent. The database refuses
 * `DELETE` on the table and the API exposes no route, so a control here would be a button that
 * cannot work. §7.3 quotes the rule on the page above precisely so the absence reads as a policy
 * rather than an oversight.
 *
 * ## Reporting is not removing, and the copy says so
 *
 * A partner who reports a review sees «بلاغك قيد المراجعة … التقييم يبقى ظاهراً حتى يصدر القرار».
 * Leaving that unsaid is how a partner comes to believe reporting takes a review down, reports
 * every review below four stars, and is angry twice.
 */
export function ReviewActions({
  reference,
  hasReply,
  reportStatus,
}: {
  readonly reference: string;
  readonly hasReply: boolean;
  readonly reportStatus: string;
}) {
  const router = useRouter();

  const [mode, setMode] = useState<'idle' | 'reply' | 'report'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: 'reply' | 'report', value: string) {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/reviews/${encodeURIComponent(reference)}/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action === 'reply' ? { reply: value } : { reason: value }),
        },
      );

      if (!response.ok) {
        setError(t.reviews.failed);
        setBusy(false);
        return;
      }

      router.refresh();
      setMode('idle');
      setBusy(false);
    } catch {
      setError(t.reviews.unreachable);
      setBusy(false);
    }
  }

  /* Already decided or already reported: there is nothing left to offer, so say which. */
  const reportNote =
    reportStatus === 'open'
      ? t.reviews.reportPending
      : reportStatus === 'upheld'
        ? t.reviews.reportUpheld
        : reportStatus === 'dismissed'
          ? t.reviews.reportDismissed
          : null;

  if (mode !== 'idle') {
    const isReply = mode === 'reply';

    return (
      <form
        className="mt-2.5 grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const raw = new FormData(event.currentTarget).get('value');
          void submit(mode, typeof raw === 'string' ? raw : '');
        }}
      >
        <label
          htmlFor={`${mode}-${reference}`}
          className="text-[11.5px] leading-relaxed text-muted"
        >
          {isReply ? t.reviews.replyLabel : t.reviews.reportLabel}
        </label>
        <textarea
          id={`${mode}-${reference}`}
          name="value"
          rows={3}
          required
          minLength={isReply ? 3 : 10}
          className="rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text"
        />
        {error ? (
          <p role="alert" className="text-[11.5px] text-bad">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="min-h-10 cursor-pointer rounded-lg border border-gold px-4 py-1.5 text-[12px] font-bold text-gold disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
          >
            {busy
              ? t.reviews.working
              : isReply
                ? t.reviews.replySubmit
                : t.reviews.reportSubmit}
          </button>
          <button
            type="button"
            onClick={() => setMode('idle')}
            className="min-h-10 cursor-pointer rounded-lg border border-line px-4 py-1.5 text-[12px] text-muted lg:min-h-0"
          >
            {t.reviews.cancel}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      {/* §7.3: الرد is a gold outline, إبلاغ a neutral one. */}
      {hasReply ? null : (
        <button
          type="button"
          onClick={() => setMode('reply')}
          className="min-h-10 cursor-pointer rounded-lg border border-gold px-4 py-1.5 text-[12px] font-bold text-gold lg:min-h-0"
        >
          {t.reviews.reply}
        </button>
      )}

      {reportStatus === 'none' ? (
        <button
          type="button"
          onClick={() => setMode('report')}
          className="min-h-10 cursor-pointer rounded-lg border border-line px-4 py-1.5 text-[12px] text-muted lg:min-h-0"
        >
          {t.reviews.report}
        </button>
      ) : null}

      {reportNote ? <span className="text-[11.5px] text-faint">{reportNote}</span> : null}
    </div>
  );
}
