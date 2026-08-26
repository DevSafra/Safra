'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { MAX_ISSUED_GIFT_CARD_AMOUNT } from '@safra/contracts';

import { t, apiError } from '@/lib/strings';

/**
 * §9.3's «+ إنشاء بطاقة هدية».
 *
 * ## The button was `aria-disabled` for a year and the reasoning was right
 *
 * Issuing a card is a liability created out of nothing: it needs an amount, a currency, an expiry,
 * a recipient, an audit entry and a delivery email, and the wrong currency creates a debt in the
 * wrong denomination. That is why it was deferred rather than half-built. This is that form.
 *
 * ## The code appears once, and the panel says so
 *
 * Only `code_hash` is stored. The plaintext exists in this response and, if an address was given,
 * in one email — nothing can recover it afterwards. So the success state is not a toast that
 * disappears: it holds the code until somebody dismisses it, with the sentence explaining why that
 * is their only chance beside it rather than after it.
 *
 * It is never written to `localStorage`, never put in the URL, and never logged. A code in any of
 * those is a spendable code sitting where somebody else can read it.
 *
 * ## Collapsed until asked for
 *
 * The registry's job is to be scannable. A permanent form above the table would push the first row
 * below the fold on a laptop, for a control most visits do not use.
 */
export function IssueGiftCardForm({ currencies }: { currencies: readonly string[] }) {
  const router = useRouter();
  const c = t.sections.giftcards;

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(currencies[0] ?? 'USD');
  const [expiresOn, setExpiresOn] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ code: string; emailed: boolean } | null>(null);

  /*
    The same shape the contract accepts — up to three decimals, because JOD has three. Whether THIS
    amount may carry three depends on its currency, which the API decides; this only stops the
    obvious typo from costing a round trip.
  */
  const amountValid =
    /^\d{1,7}(\.\d{1,3})?$/.test(amount.trim()) &&
    Number(amount) > 0 &&
    Number(amount) <= MAX_ISSUED_GIFT_CARD_AMOUNT;

  const ready = amountValid && reason.trim().length >= 3 && !busy;

  function reset(): void {
    setAmount('');
    setExpiresOn('');
    setRecipientName('');
    setRecipientEmail('');
    setReason('');
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/gift-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amount.trim(),
          currency,
          reason: reason.trim(),
          /* Omitted rather than sent empty: the contract is `.strict()` and these are optional. */
          ...(expiresOn ? { expiresOn } : {}),
          ...(recipientName.trim() ? { recipientName: recipientName.trim() } : {}),
          ...(recipientEmail.trim() ? { recipientEmail: recipientEmail.trim() } : {}),
        }),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const message =
          typeof payload === 'object' && payload !== null && 'message' in payload
            ? String(payload.message)
            : null;

        setError(apiError(message));

        return;
      }

      const payload = (await response.json()) as { code?: string };

      setIssued({ code: payload.code ?? '', emailed: recipientEmail.trim() !== '' });
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  if (issued) {
    return (
      <div className="mb-3 grid gap-2 rounded-[10px] border border-[rgba(var(--goldA),0.4)] bg-field p-3.5">
        <h3 className="text-[13px] font-bold text-gold">{c.issuedTitle}</h3>
        {/*
          `dir="ltr"` on a DISPLAYED Latin value, never on a field: the code is one Latin run and
          this is the display half of the rule, not the typing half.
        */}
        <p
          dir="ltr"
          className="select-all rounded-[9px] border border-line bg-card px-3 py-2.5 text-center font-mono text-[15px] font-bold tracking-[0.18em] text-text"
        >
          {issued.code}
        </p>
        <p className="text-[11.5px] font-semibold text-bad">{c.issuedCodeOnce}</p>
        {issued.emailed ? (
          <p className="text-[11.5px] text-muted">{c.issuedEmailed}</p>
        ) : null}
        <div className="flex">
          <button
            type="button"
            onClick={() => setIssued(null)}
            className="min-h-10 cursor-pointer rounded-lg border border-line px-4.5 py-2 text-xs font-bold text-text lg:min-h-0"
          >
            {c.issuedDone}
          </button>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="mb-3 flex">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-10 cursor-pointer rounded-lg border border-[rgba(var(--goldA),0.4)] px-4.5 py-2 text-xs font-bold text-gold transition-colors hover:bg-[rgba(var(--goldA),0.08)] lg:min-h-0"
        >
          {c.create}
        </button>
      </div>
    );
  }

  return (
    <div className="mb-3 grid gap-3 rounded-[10px] border border-line bg-field p-3.5">
      <h3 className="text-[13px] font-bold text-text">{c.issueTitle}</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
          {c.issueAmount}
          {/* No `dir` at all — a field follows the PAGE's direction; the bidi algorithm lays out digits. */}
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            className="rounded-[9px] border border-line bg-card px-3 py-2 text-[12.5px] text-text"
          />
        </label>

        <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
          {c.issueCurrency}
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            className="cursor-pointer rounded-[9px] border border-line bg-card px-3 py-2 text-[12.5px] text-text"
          >
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
          {c.issueExpiry}
          <input
            type="date"
            value={expiresOn}
            onChange={(event) => setExpiresOn(event.target.value)}
            className="rounded-[9px] border border-line bg-card px-3 py-2 text-[12.5px] text-text"
          />
        </label>

        <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
          {c.issueRecipientName}
          <input
            value={recipientName}
            onChange={(event) => setRecipientName(event.target.value)}
            className="rounded-[9px] border border-line bg-card px-3 py-2 text-[12.5px] text-text"
          />
        </label>

        <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted sm:col-span-2">
          {c.issueRecipientEmail}
          <input
            type="email"
            value={recipientEmail}
            onChange={(event) => setRecipientEmail(event.target.value)}
            className="field-ltr rounded-[9px] border border-line bg-card px-3 py-2 text-[12.5px] text-text"
          />
        </label>
      </div>

      <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
        {c.issueReason}
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          className="rounded-[9px] border border-line bg-card px-3 py-2 text-[12.5px] text-text"
        />
        <span className="font-normal text-faint">{c.issueReasonHint}</span>
      </label>

      {error ? <p className="text-[11.5px] font-semibold text-bad">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!ready}
          onClick={() => void submit()}
          className="min-h-10 cursor-pointer rounded-lg border border-[rgba(var(--goldA),0.4)] px-4.5 py-2 text-xs font-bold text-gold transition-colors hover:bg-[rgba(var(--goldA),0.08)] disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
        >
          {busy ? t.table.working : c.issueSubmit}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="min-h-10 cursor-pointer rounded-lg border border-line px-4.5 py-2 text-xs font-bold text-muted lg:min-h-0"
        >
          {c.issueCancel}
        </button>
      </div>
    </div>
  );
}
