'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import type { Locale } from '@/i18n/routing';

/**
 * EC-010 tier 1 — «نسيت رقم الحجز» (SRS §16).
 *
 * ## The screen tells the visitor nothing, on purpose
 *
 * One message on success and the SAME message whether or not the address holds a booking. An email
 * address is not a secret — it is on every invoice and in every forwarded confirmation — so a page
 * that said «no bookings found» would let anybody discover who is travelling. What was found goes
 * to the MAILBOX, which is the only party entitled to it.
 *
 * The form is replaced by the confirmation rather than left submittable, so a visitor cannot sit
 * there trying addresses and reading the difference between the answers. There is no difference to
 * read, and removing the field says so.
 */
export function FindBookingForm({ locale }: { locale: Locale }) {
  const t = useTranslations('auth');

  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    /* `FormData.get` may return a File; only a string is an address. */
    const value = form.get('email');
    const email = typeof value === 'string' ? value : '';

    void (async () => {
      try {
        await fetch(`/${locale}/api/bookings/recover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
      } catch {
        /*
        Swallowed, and the confirmation is shown anyway.

        An error the visitor can see would distinguish outcomes — and the only outcomes worth
        distinguishing here are ones this page must not reveal. A message that failed to send is a
        message the customer does not receive, which reads to them as «no bookings», which is the
        answer they would have got anyway if there were none.
        */
      }

      setSent(true);
      setSubmitting(false);
    })();
  }

  if (sent) {
    return (
      <p role="status" className="text-sm text-text">
        {t('findSent')}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <label className="grid gap-1.5">
        <span className="text-sm text-muted">{t('findEmail')}</span>
        {/*
          No `dir`: a field a person types into follows the page. An address is a left-to-right RUN
          and the bidi algorithm lays it out correctly inside an RTL field without being told.
        */}
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          disabled={submitting}
          className="min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-sm text-text disabled:cursor-not-allowed lg:min-h-0"
        />
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg bg-gold px-4 py-2.5 text-sm font-bold text-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? t('findSending') : t('findSubmit')}
      </button>

      {/* Said before submitting, so the visitor knows the answer will not be an answer. */}
      <p className="text-xs text-muted">{t('findPrivacy')}</p>
    </form>
  );
}
