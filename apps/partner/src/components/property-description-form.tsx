'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { codeOfResponse, refusalFor } from '@/lib/refusal';
import { t } from '@/lib/strings';

/**
 * Writing the first description for a listing that is PUBLISHED and has never had one.
 *
 * ## Why this exists beside the locked panel
 *
 * §8.1 freezes a published listing's structural fields, and rightly: SAFRA verified the address
 * against the documents, and letting it change afterwards would leave the «موثّق» badge making a
 * claim nobody checked.
 *
 * The description was inside that freeze — and الإعلانات reports «بلا وصف بالعربية» as a gap. So
 * the platform was naming a shortfall the partner was forbidden to close, and the link that
 * offered to fix it landed on a page with no description field at all. A prompt somebody cannot
 * act on is worse than silence: it teaches them the indicators are noise.
 *
 * ## The distinction that makes it safe is WRITING versus CHANGING
 *
 * The same one the coordinate form records, and the one Bashar approved on 2026-09-24. Marketing
 * copy is not what an inspector checked; words where there were none contradict nothing. Rewriting
 * existing copy is a different claim about the same place and stays refused — the API enforces
 * both halves per LANGUAGE, and this form is only rendered for the empty case.
 *
 * ## It is its own form, not a field in the locked one
 *
 * `PropertyEditor` submits every structural field it holds. Reusing it here would offer a partner
 * a form whose other controls the API will refuse — the «work is done and then discarded» failure.
 * This one sends a single key.
 */
export function PropertyDescriptionForm({ reference }: { readonly reference: string }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(
    null,
  );

  const written = text.trim() !== '';

  async function save() {
    if (!written || busy) return;

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/properties/${encodeURIComponent(reference)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: { ar: text.trim() } }),
      });

      if (!response.ok) {
        setMessage({
          kind: 'bad',
          text: refusalFor(await codeOfResponse(response)) ?? t.editProperty.failed,
        });
        setBusy(false);

        return;
      }

      setMessage({ kind: 'ok', text: t.editProperty.saved });
      setBusy(false);
      /*
        Refreshed so the panel disappears: once the listing has a description this form must not
        be offered again, and the SERVER decides that. Re-rendering from stale props would leave a
        partner looking at a control whose next submit the API refuses.
      */
      router.refresh();
    } catch {
      setMessage({ kind: 'bad', text: t.editProperty.unreachable });
      setBusy(false);
    }
  }

  return (
    <section
      id="description"
      className="grid gap-3 scroll-mt-24 rounded-card border border-line bg-card p-4"
    >
      <div>
        <h3 className="text-14 font-bold text-text">
          {t.editProperty.descriptionGapHeading}
        </h3>
        <p className="mt-1 text-12 leading-relaxed text-faint">
          {t.editProperty.descriptionGapHelp}
        </p>
      </div>

      {message ? (
        <p
          role="alert"
          className={`rounded-lg border p-2.5 text-13 ${
            message.kind === 'ok'
              ? 'border-ok/40 bg-ok/10 text-ok'
              : 'border-bad/40 bg-bad/10 text-bad'
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <label className="grid gap-1 text-12 text-muted">
        {t.editProperty.descriptionAr}
        {/*
          No `dir="ltr"`, ever, on something a person types into. The page is RTL, so the label,
          the caret and the text all start on the right — the standing UI rule, and the reason a
          unit number once rendered at the far left of its own field.
        */}
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setMessage(null);
          }}
          rows={5}
          className="rounded-lg border border-line bg-field px-3 py-2 text-14 leading-relaxed text-text"
        />
      </label>

      <button
        type="button"
        disabled={!written || busy}
        onClick={() => void save()}
        className="min-h-10 w-fit cursor-pointer rounded-lg border border-gold px-4 py-1.5 text-13 font-bold text-gold-read transition-colors hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
      >
        {busy ? t.editProperty.saving : t.editProperty.save}
      </button>
    </section>
  );
}
