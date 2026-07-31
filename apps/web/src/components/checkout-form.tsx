'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import type { CustomerFacingMethod } from '@safra/contracts';

import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/localise';

interface FieldErrors {
  [field: string]: string | undefined;
}

/**
 * Guest details and submit (SRS §6.3 steps 1–4).
 *
 * A client component because it needs three things a plain form cannot give: a
 * stable idempotency key across retries, inline field errors from the API, and a
 * disabled button during submission.
 *
 * §4 allows booking with no account, so nothing here asks the customer to register.
 */
export function CheckoutForm({
  locale,
  unitId,
  checkIn,
  checkOut,
  adults,
  propertySlug,
  methods,
  wallet,
  signedIn,
}: {
  locale: Locale;
  unitId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  propertySlug: string;
  /**
   * Resolved server-side from provider routing (§7.1). May legitimately be empty
   * while no external rail is contracted, which is why the form still submits
   * without one — the booking is worth taking even if payment follows out of band.
   */
  methods: readonly CustomerFacingMethod[];
  /**
   * The customer's spendable balance in THIS booking's currency (§7.3), or null
   * when there is none to offer. Resolved server-side; the amount shown here is
   * advisory, and the API recomputes what it actually applies.
   */
  wallet: { balance: string; currencyCode: string; total: string } | null;
  signedIn: boolean;
}) {
  const t = useTranslations('checkout');
  const tm = useTranslations('paymentMethods');
  const router = useRouter();

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  /** Defaults to the first offered method, matching the approved display order. */
  const [method, setMethod] = useState<CustomerFacingMethod | undefined>(methods[0]);

  /**
   * Opt-IN, not opt-out.
   *
   * Spending stored value is irreversible from the customer's point of view — it is
   * their money, and a balance quietly consumed by a booking they were only halfway
   * committed to is a support ticket at best. Defaulting to off means using it is
   * always a deliberate act.
   */
  const [applyWallet, setApplyWallet] = useState(false);

  /**
   * Generated ONCE per mounted form, not per submit (EC-003).
   *
   * That is the whole point: if the customer double-clicks, or the network drops and
   * they retry, the same key reaches the API and the second request returns the FIRST
   * booking instead of creating a duplicate. Regenerating it on submit would defeat
   * the protection entirely.
   */
  const [idempotencyKey] = useState(() => `co-${crypto.randomUUID()}`);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);

    try {
      // Posts to our own route handler, not the API directly: that keeps the API
      // origin out of the browser and lets the server attach the real client IP.
      const response = await fetch(`/${locale}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unitId,
          checkIn,
          checkOut,
          adults,
          guest: {
            fullName: text(form, 'fullName'),
            email: text(form, 'email'),
            phone: text(form, 'phone'),
          },
          idempotencyKey,
        }),
      });

      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        applyError(body, response.status, { setFormError, setFieldErrors, t });
        return;
      }

      const created = readCreated(body);

      if (!created) {
        setFormError(t('genericError'));
        return;
      }

      /**
       * The booking exists but holds the dates only until the payment window
       * lapses (EC-001), so payment starts immediately rather than on another
       * click. From here the booking is recoverable: the access token authorizes
       * a retry, and a failure below is not a lost booking.
       */
      await startPayment(created, { locale, router, method, applyWallet });
    } catch {
      // A network failure is safe to retry: the idempotency key is unchanged, so a
      // booking that did reach the server will be returned rather than duplicated.
      setFormError(t('networkError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="rounded-card border border-line bg-card p-5"
    >
      <h2 className="font-display text-lg text-text">{t('guestDetails')}</h2>
      <p className="mt-1 text-sm text-faint">{t('noAccountNeeded')}</p>

      {formError ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
        >
          {formError}
        </p>
      ) : null}

      <div className="mt-5 grid gap-4">
        <Field
          name="fullName"
          label={t('fullName')}
          autoComplete="name"
          error={fieldErrors['guest.fullName']}
          required
        />
        <Field
          name="email"
          type="email"
          label={t('email')}
          autoComplete="email"
          error={fieldErrors['guest.email']}
          required
        />
        <Field
          name="phone"
          type="tel"
          label={t('phone')}
          placeholder="+963912345678"
          autoComplete="tel"
          hint={t('phoneHint')}
          error={fieldErrors['guest.phone']}
          required
        />
      </div>

      {/* ── SAFRA balance (§7.3) ─────────────────────────────────────────── */}
      {wallet ? (
        <div className="mt-6 rounded-lg border border-gold/30 bg-gold/5 p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={applyWallet}
              onChange={(event) => setApplyWallet(event.target.checked)}
              className="mt-0.5 accent-gold"
            />
            <span>
              <span className="block text-sm text-text">
                {t('walletApply', {
                  amount: formatMoney(wallet.balance, wallet.currencyCode, locale),
                })}
              </span>
              <span className="block text-xs text-faint">
                {coversEverything(wallet)
                  ? t('walletCoversAll')
                  : t('walletRemaining') +
                    ': ' +
                    formatMoney(
                      remainder(wallet, applyWallet),
                      wallet.currencyCode,
                      locale,
                    )}
              </span>
            </span>
          </label>
        </div>
      ) : signedIn ? null : (
        /*
         * Shown to guests as an invitation, not an obstacle. §4 keeps guest checkout
         * open, so this must never read as "you must sign in" — it says only that
         * there is a balance feature and an account is how to reach it.
         */
        <p className="mt-6 rounded-lg border border-line bg-card p-3 text-xs text-faint">
          {t('walletSignedOut')}
        </p>
      )}

      {/* ── Payment method (§7.1) ────────────────────────────────────────── */}
      <fieldset className="mt-6">
        <legend className="text-sm text-muted">{tm('heading')}</legend>

        {methods.length === 0 ? (
          /*
           * Said plainly rather than hidden. No external rail is contracted yet, and
           * a customer who reaches checkout deserves to know payment will be arranged
           * separately — not to meet a dead button or an empty box.
           */
          <p className="mt-2 rounded-lg border border-sky/30 bg-sky/10 p-3 text-xs text-sky">
            {tm('none')}
          </p>
        ) : (
          <div className="mt-2 grid gap-2">
            {methods.map((option) => (
              <label
                key={option}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  method === option
                    ? 'border-gold bg-gold/5'
                    : 'border-line hover:border-gold/50'
                }`}
              >
                <input
                  type="radio"
                  name="method"
                  value={option}
                  checked={method === option}
                  onChange={() => setMethod(option)}
                  className="mt-0.5 accent-gold"
                />
                <span>
                  <span className="block text-sm text-text">{tm(option)}</span>
                  <span className="block text-xs text-faint">
                    {methodHint(option, tm)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <button
        type="submit"
        disabled={submitting}
        className="mt-6 w-full rounded-lg bg-gold px-5 py-3 font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? t('submitting') : t('submit')}
      </button>

      <p className="mt-3 text-xs text-faint">{t('terms')}</p>

      <input type="hidden" name="propertySlug" value={propertySlug} />
    </form>
  );
}

/**
 * One line of reassurance per rail.
 *
 * Each says the thing a customer is most likely to be uncertain about: that a card
 * will bounce them to their bank (§SCA, so the redirect is expected rather than
 * alarming), that Klarna defers the charge, and that Sham Cash only works inside
 * Syria. Grouped in one function so the mapping is readable in one place.
 */
function methodHint(method: CustomerFacingMethod, tm: (key: string) => string): string {
  switch (method) {
    case 'klarna':
      return tm('klarnaHint');
    case 'sham_cash':
      return tm('shamCashHint');
    case 'visa':
    case 'mastercard':
      return tm('cardHint');
  }
}

interface CreatedBooking {
  reference: string;
  accessToken: string;
}

/**
 * Pulls the reference and access token out of the creation response.
 *
 * The token is returned exactly once and is the ONLY thing that will authorize this
 * guest to pay — references are sequential (§13.2), so the API cannot accept one
 * alone. If it is missing, the booking is unpayable and saying so beats redirecting
 * to a page that silently cannot proceed.
 */
function readCreated(body: unknown): CreatedBooking | null {
  if (typeof body !== 'object' || body === null) return null;

  const record = body as Record<string, unknown>;

  return typeof record['reference'] === 'string' &&
    typeof record['accessToken'] === 'string'
    ? { reference: record['reference'], accessToken: record['accessToken'] }
    : null;
}

/**
 * Starts payment and sends the customer wherever the provider needs them.
 *
 * `redirectUrl` is followed with a full navigation rather than the Next router: it
 * points at a payment provider (or, for bank transfer, at an instructions page),
 * and a client-side route transition cannot leave the origin.
 *
 * If this step fails the customer is still sent to the booking page. The booking is
 * real and held, so stranding them on the form with an error would hide it from
 * them entirely.
 */
async function startPayment(
  created: CreatedBooking,
  handlers: {
    locale: Locale;
    router: { push: (href: string) => void };
    method: CustomerFacingMethod | undefined;
    applyWallet: boolean;
  },
): Promise<void> {
  const { locale, router, method, applyWallet } = handlers;

  try {
    const response = await fetch(`/${locale}/api/payments/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference: created.reference,
        accessToken: created.accessToken,
        // Omitted rather than sent as null when nothing is offered: the request
        // schema is .strict() and rejects unknown or ill-typed fields.
        ...(method ? { method } : {}),
        /**
         * A flag, never an amount. The API derives how much to apply from the
         * balance and the total — a figure sent from here would be a
         * client-supplied price, which is the one thing checkout must never send.
         */
        ...(applyWallet ? { applyWallet: true } : {}),
      }),
    });

    const body: unknown = await response.json().catch(() => null);

    if (response.ok && typeof body === 'object' && body !== null) {
      const redirectUrl = (body as Record<string, unknown>)['redirectUrl'];

      if (typeof redirectUrl === 'string') {
        window.location.assign(redirectUrl);
        return;
      }
    }
  } catch {
    // Fall through: the booking is held either way, and the pending page explains
    // what happens next. A network blip must not look like a failed booking.
  }

  router.push(`/${locale}/booking/${created.reference}`);
}

/** Whether the balance settles the booking outright, so nothing goes to a gateway. */
function coversEverything(wallet: { balance: string; total: string }): boolean {
  return minor(wallet.balance) >= minor(wallet.total);
}

/** What is still owed once the balance is applied. Display only — the API decides. */
function remainder(wallet: { balance: string; total: string }, applied: boolean): string {
  if (!applied) return wallet.total;

  const due = minor(wallet.total) - minor(wallet.balance);
  const value = due > 0n ? due : 0n;

  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

/**
 * Parses a two-decimal amount into integer minor units.
 *
 * Even here, in display code, the amount never becomes a float: `201.99 - 50.00`
 * evaluates to 151.99000000000004 as a double, and a checkout page showing that is
 * a checkout page nobody trusts.
 */
function minor(amount: string): bigint {
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2) || '0');
}

/**
 * Reads a text field from FormData.
 *
 * `FormData.get` returns `string | File`, so coercing it with String() would turn a
 * file input into the literal "[object File]" and post it as someone's name. Anything
 * that is not a string is treated as absent, and the API's schema rejects it.
 */
function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function Field({
  name,
  label,
  error,
  hint,
  ...rest
}: {
  name: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = `field-${name}`;
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-muted">
        {label} <span className="text-gold">*</span>
      </label>
      <input
        id={id}
        name={name}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy || undefined}
        className={`rounded-lg border bg-field px-3 py-2.5 text-text ${
          error ? 'border-bad' : 'border-line'
        }`}
        {...rest}
      />
      {hint ? (
        <span id={`${id}-hint`} className="text-xs text-faint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-error`} className="text-xs text-bad">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Turns an API error into something the customer can act on.
 *
 * The two cases that matter are the ones the SRS defines: a 409 means the dates were
 * taken while they were filling the form (EC-005), and a 400 with `firstBookableDate`
 * means the same-day cutoff closed (§5.3). Both are normal outcomes, not faults, and
 * a generic "something went wrong" would leave the customer with no idea what to do.
 */
function applyError(
  body: unknown,
  status: number,
  handlers: {
    setFormError: (message: string) => void;
    setFieldErrors: (errors: FieldErrors) => void;
    t: (key: string, values?: Record<string, string | number>) => string;
  },
): void {
  const { setFormError, setFieldErrors, t } = handlers;

  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>;

    // Field-level validation errors from the shared Zod schema.
    if (Array.isArray(record['errors'])) {
      const mapped: FieldErrors = {};

      for (const entry of record['errors']) {
        if (typeof entry === 'object' && entry !== null && 'field' in entry) {
          const item = entry as { field?: unknown; message?: unknown };
          if (typeof item.field === 'string' && typeof item.message === 'string') {
            mapped[item.field] = item.message;
          }
        }
      }

      if (Object.keys(mapped).length > 0) {
        setFieldErrors(mapped);
        setFormError(t('fixFields'));
        return;
      }
    }

    if (status === 409) {
      setFormError(t('datesTaken'));
      return;
    }

    if (
      record['reason'] === 'same_day_closed' &&
      typeof record['firstBookableDate'] === 'string'
    ) {
      setFormError(t('cutoffClosed', { date: record['firstBookableDate'] }));
      return;
    }

    if (typeof record['message'] === 'string') {
      setFormError(record['message']);
      return;
    }
  }

  setFormError(t('genericError'));
}
