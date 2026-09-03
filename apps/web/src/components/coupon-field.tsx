'use client';

import { useState } from 'react';

import { formatMoney } from '@/lib/localise';
import { useCoupon } from './coupon-context';

/**
 * «هل لديك كود خصم؟» — the customer's own coupon entry (§9.3's الكوبونات).
 *
 * ## It lives in the summary, beside the money it changes
 *
 * A discount entered somewhere else and reflected here would leave the customer looking for the
 * number that moved. The applied line and the new total appear directly under this field.
 *
 * ## The server prices it, always
 *
 * This sends only the code and the stay. What a coupon is worth is decided on the server against
 * prices the server computed — a discount the browser calculated would be a price the customer
 * chose. Nothing is reserved either: the redemption happens when the booking is created, under the
 * coupon's row lock, and the code is re-judged from scratch at that moment.
 *
 * ## Every refusal is the server's sentence, translated
 *
 * `coupon.expired`, `coupon.customer_limit` and `coupon.minimum_not_met` are different problems
 * with different answers, and collapsing them into «invalid» would tell somebody to give up when
 * the fix was to come back tomorrow. The message comes from the catalogue by CODE; the English the
 * API carries for logs is never shown.
 */
export function CouponField({
  locale,
  unitId,
  checkIn,
  checkOut,
  currencyCode,
  copy,
}: {
  readonly locale: 'ar' | 'en' | 'de';
  readonly unitId: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly currencyCode: string;
  /** Resolved on the server so this component carries no catalogue of its own. */
  readonly copy: {
    label: string;
    placeholder: string;
    apply: string;
    applying: string;
    remove: string;
    applied: string;
    invalid: string;
    messages: Record<string, string>;
  };
}) {
  const { applied, apply } = useCoupon();

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/${locale}/api/coupon-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), unitId, checkIn, checkOut }),
      });

      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const returned =
          typeof body === 'object' && body !== null && 'message' in body
            ? String(body.message)
            : '';

        /* By CODE. An unknown one falls back to the general sentence rather than showing English. */
        setError(copy.messages[returned] ?? copy.invalid);

        return;
      }

      const priced = body as {
        code?: string;
        discountAmount?: string;
        totalAfter?: string;
      };

      if (!priced.code || !priced.discountAmount || !priced.totalAfter) {
        setError(copy.invalid);

        return;
      }

      apply({
        code: priced.code,
        discountAmount: priced.discountAmount,
        totalAfter: priced.totalAfter,
      });
      setCode('');
    } catch {
      setError(copy.invalid);
    } finally {
      setBusy(false);
    }
  }

  if (applied) {
    return (
      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-line bg-field px-3 py-2 text-sm">
        <span className="min-w-0 truncate text-text">
          {copy.applied.replace('{code}', applied.code)}
        </span>
        <span className="whitespace-nowrap text-gold-ink">
          −{formatMoney(applied.discountAmount, currencyCode, locale)}
        </span>
        <button
          type="button"
          onClick={() => apply(null)}
          className="cursor-pointer text-xs font-semibold text-muted underline"
        >
          {copy.remove}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 grid gap-1.5">
      <label className="text-sm text-muted" htmlFor="coupon-code">
        {copy.label}
      </label>
      <div className="flex gap-2">
        {/*
          No `dir` — a field follows the page's direction, and a code is a Latin RUN the bidi
          algorithm lays out correctly inside an RTL field without being told.

          Deliberately NOT inside the checkout `<form>`: Enter here must price the coupon, not
          submit the booking.
        */}
        <input
          id="coupon-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (code.trim() !== '' && !busy) void submit();
            }
          }}
          placeholder={copy.placeholder}
          className="min-h-10 min-w-0 flex-1 rounded-lg border border-line bg-field px-3 py-2 text-sm text-text"
        />
        <button
          type="button"
          disabled={code.trim() === '' || busy}
          onClick={() => void submit()}
          className="min-h-10 cursor-pointer rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-text disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? copy.applying : copy.apply}
        </button>
      </div>
      {error ? <p className="text-sm text-bad">{error}</p> : null}
    </div>
  );
}
