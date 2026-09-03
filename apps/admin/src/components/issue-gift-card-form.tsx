'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { preferredCurrency, type GiftCardCurrency } from '@safra/contracts';

import { t, apiErrorOf } from '@/lib/strings';
import { TableToolbar } from './table-toolbar';

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
export function GiftCardsToolbar({
  action,
  query,
  size,
  placeholder,
  currencies,
}: {
  readonly action: string;
  readonly query: string | undefined;
  readonly size: number;
  readonly placeholder: string;
  readonly currencies: readonly GiftCardCurrency[];
}) {
  const router = useRouter();
  const c = t.sections.giftcards;

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  /*
    The platform's standard currency, not `currencies[0]`.

    `GIFT_CARD_CURRENCIES` is written SYP-first because that is the order its reasoning is written
    in, so the first entry decided what a staff-issued card was DENOMINATED in whenever nobody
    touched the select — a card in SYP where USD was meant is out by four orders of magnitude, and
    SAFRA has to honour it. `preferredCurrency` is the one answer to «which when nobody said».
  */
  const [currency, setCurrency] = useState<GiftCardCurrency>(
    preferredCurrency(currencies),
  );
  const [expiresOn, setExpiresOn] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ code: string } | null>(null);

  /*
    The same shape the contract accepts — up to three decimals, because JOD has three. Whether THIS
    amount may carry three depends on its currency, which the API decides; this only stops the
    obvious typo from costing a round trip.
  */
  /*
    Shape and sign only — the CEILING is the server's call.

    It is a setting now (`giftcard.max_issue_usd` and friends), per currency, and the browser cannot
    read one. Checking against the compiled-in default would block a legitimate amount the moment
    the business raised the ceiling — the drift this move to settings exists to end. An amount over
    the configured value comes back as a translatable refusal instead.
  */
  const amountValid = /^\d{1,10}(\.\d{1,3})?$/.test(amount.trim()) && Number(amount) > 0;

  /*
    A plausible address before the button arms.

    Not a validator — the schema and the service both decide — but the address is now how the card
    REACHES anybody, so an obvious typo must not cost a round trip and, worse, a moment where the
    operator does not know whether a card was created.
  */
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim());
  const ready = amountValid && emailValid && reason.trim().length >= 3 && !busy;

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
          recipientEmail: recipientEmail.trim(),
        }),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setError(apiErrorOf(payload));

        return;
      }

      const payload = (await response.json()) as { code?: string };

      setIssued({ code: payload.code ?? '' });
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  const panel = issued ? (
    <div className="grid w-full gap-2 rounded-card border border-[rgba(var(--goldA),0.4)] bg-field p-3.5">
      <h3 className="text-[13px] font-bold text-gold-ink">{c.issuedTitle}</h3>
      {/*
          `dir="ltr"` on a DISPLAYED Latin value, never on a field: the code is one Latin run and
          this is the display half of the rule, not the typing half.
        */}
      {/*
          The whole code, visible at every width (Bashar, 2026-08-26).

          It was one line at 15px with 0.18em of tracking — twenty-three characters that do not fit
          the panel on a phone, and a code somebody can only half see is a code they cannot use.
          Three things make it fit: `break-all` so it wraps rather than overflowing, tighter
          tracking, and a size that steps up only when there is room for it.

          Still ONE string rather than four chips: `select-all` has to yield the code exactly as it
          is typed into the redeem box, and a flex row of groups copies with whatever whitespace the
          browser puts between them.
        */}
      <p
        dir="ltr"
        className="select-all rounded-lg border border-line bg-card px-3 py-3 text-center font-mono text-[13px] leading-relaxed font-bold tracking-[0.1em] break-all text-text sm:text-[15px] sm:tracking-[0.16em]"
      >
        {issued.code}
      </p>
      <p className="text-[11.5px] font-semibold text-bad">{c.issuedCodeOnce}</p>
      {/* Always: the address is required, so a card is never issued without being sent. */}
      <p className="text-[11.5px] text-muted">{c.issuedEmailed}</p>
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
  ) : !open ? null : (
    <div className="grid w-full gap-3 rounded-card border border-line bg-field p-3.5">
      <h3 className="text-[13px] font-bold text-text">{c.issueTitle}</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
          {c.issueAmount}
          {/* No `dir` at all — a field follows the PAGE's direction; the bidi algorithm lays out digits. */}
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={c.issueAmountPlaceholder}
            inputMode="decimal"
            className="rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-text"
          />
        </label>

        <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
          {c.issueCurrency}
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value as GiftCardCurrency)}
            className="cursor-pointer rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-text"
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
            className="rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-text"
          />
        </label>

        <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
          {c.issueRecipientName}
          <input
            value={recipientName}
            onChange={(event) => setRecipientName(event.target.value)}
            className="rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-text"
          />
        </label>

        <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted sm:col-span-2">
          {c.issueRecipientEmail}
          <input
            type="email"
            value={recipientEmail}
            onChange={(event) => setRecipientEmail(event.target.value)}
            placeholder={c.issueRecipientEmailPlaceholder}
            className="field-ltr rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-text"
          />
        </label>
      </div>

      <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
        {c.issueReason}
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          className="rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-text"
        />
        <span className="font-normal text-faint">{c.issueReasonHint}</span>
      </label>

      {error ? <p className="text-[11.5px] font-semibold text-bad">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!ready}
          onClick={() => void submit()}
          className="min-h-10 cursor-pointer rounded-lg border border-[rgba(var(--goldA),0.4)] px-4.5 py-2 text-xs font-bold text-gold-ink transition-colors hover:bg-[rgba(var(--goldA),0.08)] disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
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

  return (
    <TableToolbar
      action={action}
      query={query}
      size={size}
      placeholder={placeholder}
      /*
        The trigger sits where «الإنشاء والتعديل بصلاحيات إدارية محددة فقط» used to. It is hidden
        while the panel is open — a control that opens something already open is a dead press, and
        the panel carries its own إلغاء.
      */
      end={
        panel === null ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="min-h-10 cursor-pointer rounded-lg border border-[rgba(var(--goldA),0.4)] px-4 py-1.5 text-[12.5px] font-extrabold text-gold-ink transition-colors hover:bg-[rgba(var(--goldA),0.08)] lg:min-h-0"
          >
            {c.create}
          </button>
        ) : null
      }
      below={panel}
    />
  );
}
