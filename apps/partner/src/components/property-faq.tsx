'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { PropertyFaqQuestion } from '@/lib/api';
import { codeOfResponse, refusalFor } from '@/lib/refusal';
import { t } from '@/lib/strings';

/**
 * الأسئلة الشائعة — SAFRA's questions about this listing, answered here (Bashar, 2026-09-28).
 *
 * ## Why this is not inside `PropertyEditor`
 *
 * The same reason `PropertyAmenities` is not: that form is gated behind `isStructurallyEditable`
 * and rightly so — a published listing cannot change the address SAFRA verified. An FAQ answer is
 * not that. «Is breakfast included» stops being true when the kitchen closes, and a listing that
 * cannot correct it keeps promising a guest something that is no longer so. Answers sit with the
 * prices, the calendar and the photographs on the operational side of that line.
 *
 * ## Every question is shown, answered or not
 *
 * Including the ones this listing has never answered, because the form is where a partner LEARNS
 * what is being asked. Showing only answered questions would make a required question invisible
 * until the API refused the submission — the «refused for something nobody told them about» shape
 * the readiness model warns about.
 *
 * A retired question appears only when it already has an answer, and says so: SAFRA has stopped
 * asking, the answer is still on the public page, and the partner may still correct it.
 *
 * ## Saved as a set
 *
 * One `PUT` carrying every answer, not one request per box. «Are the required ones answered» is a
 * question about the whole set, and a per-question save could only ever answer it one question at
 * a time — leaving a partner who filled three of four boxes believing they were done.
 */
export function PropertyFaq({
  reference,
  questions,
}: {
  readonly reference: string;
  readonly questions: readonly PropertyFaqQuestion[];
}) {
  const router = useRouter();

  const [answers, setAnswers] = useState<
    Record<string, { ar: string; en: string; de: string }>
  >(() =>
    Object.fromEntries(
      questions.map((q) => [
        q.id,
        { ar: q.answerAr ?? '', en: q.answerEn ?? '', de: q.answerDe ?? '' },
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (questions.length === 0) {
    return (
      <section className="grid gap-2 rounded-card border border-line bg-card p-4">
        <h2 className="text-16 font-bold text-text">{t.faq.title}</h2>
        <p className="text-13 text-faint">{t.faq.empty}</p>
      </section>
    );
  }

  function set(id: string, locale: 'ar' | 'en' | 'de', value: string): void {
    setSaved(false);
    setAnswers((current) => ({
      ...current,
      [id]: { ...(current[id] ?? { ar: '', en: '', de: '' }), [locale]: value },
    }));
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(false);

    try {
      /*
        Only answered questions are sent. An empty box is «not answered», and posting it as an
        empty string would fail the contract's `min(1)` for every question the partner has not
        reached yet — refusing the whole save because of a box they were never going to fill.
      */
      const payload = questions
        .map((question) => ({ question, value: answers[question.id] }))
        .filter((pair) => (pair.value?.ar ?? '').trim() !== '')
        .map((pair) => ({
          questionId: pair.question.id,
          answerAr: (pair.value?.ar ?? '').trim(),
          answerEn: (pair.value?.en ?? '').trim() || null,
          answerDe: (pair.value?.de ?? '').trim() || null,
        }));

      const response = await fetch(
        `/api/properties/${encodeURIComponent(reference)}/faq`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: payload }),
        },
      );

      if (!response.ok) {
        setError(refusalFor(await codeOfResponse(response)));

        return;
      }

      setSaved(true);
      router.refresh();
    } catch {
      setError(refusalFor(null));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-3 rounded-card border border-line bg-card p-4">
      <div className="grid gap-1">
        <h2 className="text-16 font-bold text-text">{t.faq.title}</h2>
        <p className="text-13 leading-relaxed text-faint">{t.faq.note}</p>
        <p className="text-13 leading-relaxed text-faint">{t.faq.requiredNote}</p>
      </div>

      <ul className="grid gap-4">
        {questions.map((question) => {
          const value = answers[question.id] ?? { ar: '', en: '', de: '' };
          const missing = question.isRequired && value.ar.trim() === '';

          return (
            <li
              key={question.id}
              className="grid gap-2 border-t border-line pt-4 first:border-0 first:pt-0"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-14 font-bold text-text">{question.questionAr}</span>
                <span
                  className={
                    question.isRequired
                      ? 'rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-12 text-gold-read'
                      : 'rounded-full border border-line px-2 py-0.5 text-12 text-faint'
                  }
                >
                  {question.isRequired ? t.faq.required : t.faq.optional}
                </span>
              </div>

              {question.isActive ? null : (
                <p className="text-13 text-faint">{t.faq.retired}</p>
              )}

              <label className="grid gap-1 text-13 font-semibold text-muted">
                {t.faq.answerAr}
                <textarea
                  value={value.ar}
                  onChange={(event) => set(question.id, 'ar', event.target.value)}
                  rows={2}
                  aria-invalid={missing}
                  data-faq-answer={question.id}
                  className="rounded-lg border border-line bg-bg px-3 py-2 text-14 leading-relaxed text-text aria-[invalid=true]:border-bad"
                />
              </label>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-13 font-semibold text-muted">
                  {t.faq.answerEn}
                  <textarea
                    value={value.en}
                    onChange={(event) => set(question.id, 'en', event.target.value)}
                    rows={2}
                    className="rounded-lg border border-line bg-bg px-3 py-2 text-14 leading-relaxed text-text"
                  />
                </label>
                <label className="grid gap-1 text-13 font-semibold text-muted">
                  {t.faq.answerDe}
                  <textarea
                    value={value.de}
                    onChange={(event) => set(question.id, 'de', event.target.value)}
                    rows={2}
                    className="rounded-lg border border-line bg-bg px-3 py-2 text-14 leading-relaxed text-text"
                  />
                </label>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-13 text-faint">{t.faq.localeHint}</p>

      {error ? <p className="text-13 text-bad">{error}</p> : null}
      {saved ? <p className="text-13 text-ok">{t.faq.saved}</p> : null}

      <div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          data-faq-save
          className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-[rgba(var(--goldA),0.4)] px-4 py-2 text-14 font-bold text-gold-read transition-colors hover:bg-[rgba(var(--goldA),0.08)] disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
        >
          {busy ? t.faq.saving : t.faq.save}
        </button>
      </div>
    </section>
  );
}
