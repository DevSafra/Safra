'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { PARTNER_DOCUMENT_KINDS, type PartnerDocumentKind } from '@safra/contracts';

import type { PartnerDocument } from '@/lib/api';
import { documentKind, fill, t } from '@/lib/strings';
import { count } from '@/lib/format';

/**
 * Sending SAFRA the verification documents (step 5 of «انضم كشريك», Bashar 2026-08-19).
 *
 * ## One field per kind, all required (Bashar, 2026-08-21)
 *
 * This was a `<select>` of kinds beside a single file input. The partner had to know the list,
 * pick one, upload, and come back — and nothing on the screen said how many times, so the only way
 * to discover that four more were expected was to be told. Worse, the select defaulted to
 * `identity`: the cheapest wrong outcome was a title deed filed as a passport, which costs a
 * review cycle and a rejection note to undo.
 *
 * A field per kind makes the list the form. What is asked for, what has arrived and what is still
 * missing are one thing to read, and the kind is no longer something to get wrong.
 *
 * ## What "required" means here, and what it costs
 *
 * All five, unconditionally. That is a deliberate simplification of the rule the customer site
 * used to state — «سجل تجاري … إن وجد», and a title deed OR a management contract — which is a
 * more accurate description of the world: a sole owner has no commercial register, and somebody
 * who manages rather than owns has no deed.
 *
 * Expressing that properly is not a UI change. "One of these two" and "this one unless you are a
 * sole trader" are rules the API would have to enforce as well, since the console's verification
 * queue is where they actually bite — and neither the schema nor `partnerVerifySchema` has a
 * notion of a conditional requirement today. Until it does, asking for all five is the honest
 * shape: it is a rule a partner can satisfy and a reviewer can check, and the alternative is a
 * form that appears to accept three documents and a queue that rejects it.
 *
 * `neededIdentity` and its four siblings say the same five things in the same order, so the page
 * cannot describe one rule while the form demands another.
 *
 * ## A kind that has already arrived shows its state, not an empty demand
 *
 * A partner returning after one rejection would otherwise face five empty required fields and no
 * way to tell which one was the problem. A settled kind renders as «أُرسل» with an optional
 * replace; only what is outstanding is required, so the button unlocks on the work that is left.
 *
 * ## The bytes go through the API, not to a bucket
 *
 * A presigned upload would land an unvalidated object next to other partners' identity documents.
 * `multipart/form-data` here, so the API sees the file, checks it and decides — the same choice
 * property images make, for a more sensitive file.
 */
export function DocumentUpload({ sent }: { readonly sent: readonly PartnerDocument[] }) {
  const router = useRouter();

  const [files, setFiles] = useState<Partial<Record<PartnerDocumentKind, File>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
    The newest document per kind. `sent` arrives newest-first from the API, so the first match is
    the one that counts — a partner who replaced a rejected passport has two `identity` rows and
    only the later one describes where they stand.
  */
  const newest = (kind: PartnerDocumentKind): PartnerDocument | undefined =>
    sent.find((document) => document.kind === kind);

  /** Settled: it has arrived and nobody has sent it back. A rejected kind is outstanding again. */
  const settled = (kind: PartnerDocumentKind): boolean => {
    const document = newest(kind);

    return document !== undefined && document.status !== 'rejected';
  };

  const outstanding = PARTNER_DOCUMENT_KINDS.filter((kind) => !settled(kind));
  const missing = outstanding.filter((kind) => !files[kind]);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (busy) return;

    setBusy(true);
    setError(null);

    /*
      Sequentially, and it stops at the first failure.

      Each upload is its own request — the API takes one document at a time — so five files are
      five POSTs. In series rather than in parallel because the failure has to be attributable: a
      partner told only «تعذّر رفع المستند» after five concurrent requests cannot tell which file
      to fix. Whatever succeeded before the failure is already stored, so the retry is the
      remainder rather than the whole set; that is what `settled` above is for.
    */
    for (const [kind, file] of Object.entries(files) as [PartnerDocumentKind, File][]) {
      const body = new FormData();

      body.set('kind', kind);
      body.set('file', file);

      const ok = await fetch('/api/documents', { method: 'POST', body })
        .then((response) => response.ok)
        /* A network failure and a refusal are the same thing to this form: that file did not land. */
        .catch(() => false);

      if (!ok) {
        setError(fill(t.contracts.uploadFailedOne, { kind: documentKind(kind) }));
        setBusy(false);
        router.refresh();

        return;
      }
    }

    setFiles({});
    setBusy(false);
    router.refresh();
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid gap-3 rounded-xl border border-line bg-field p-3.5"
    >
      {/*
        The intro is a DEMAND, so it goes when there is nothing left to demand. A form still
        reading «كل المستندات التالية مطلوبة» over five rows that all say «أُرسل» contradicts
        itself, and the reader has to work out which half is stale.
      */}
      <p
        className={`text-[11.5px] leading-relaxed ${
          outstanding.length === 0 ? 'text-ok' : 'text-muted'
        }`}
      >
        {outstanding.length === 0
          ? t.contracts.uploadAllSent
          : t.contracts.uploadAllIntro}
      </p>

      {PARTNER_DOCUMENT_KINDS.map((kind) => (
        <DocumentField
          key={kind}
          kind={kind}
          document={newest(kind)}
          settled={settled(kind)}
          chosen={files[kind]}
          onPick={(file) =>
            setFiles((current) => {
              const next = { ...current };

              if (file) next[kind] = file;
              else delete next[kind];

              return next;
            })
          }
        />
      ))}

      {error ? (
        <p role="alert" className="text-[11.5px] text-bad">
          {error}
        </p>
      ) : null}

      <div
        className={`flex flex-wrap items-center gap-3 ${
          /* Nothing outstanding and nothing chosen: the button has no work, so it is not offered. */
          outstanding.length === 0 && Object.keys(files).length === 0 ? 'hidden' : ''
        }`}
      >
        <button
          type="submit"
          /*
            Blocked while anything required is unchosen — that is what "all of them are required"
            means on a form that submits once. `missing.length` counts only what is OUTSTANDING,
            so a partner replacing one rejected document is not asked for the four that are fine.
          */
          disabled={busy || missing.length > 0 || Object.keys(files).length === 0}
          className="min-h-10 w-fit cursor-pointer rounded-lg bg-[linear-gradient(135deg,#F0CB7C,#C4923E)] px-5 text-[12.5px] font-extrabold text-[#241A05] disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0 lg:py-2"
        >
          {busy ? t.contracts.uploading : t.contracts.upload}
        </button>

        {/*
          The count of what is left, beside the button that is waiting for it. A disabled button
          with no explanation is the commonest way a form becomes a support ticket.
        */}
        {missing.length > 0 ? (
          <span className="text-[11.5px] text-faint">
            {fill(t.contracts.uploadRemaining, { n: count(missing.length) })}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/** One kind: what it is, whether it has arrived, and a file input when it has not. */
function DocumentField({
  kind,
  document,
  settled,
  chosen,
  onPick,
}: {
  readonly kind: PartnerDocumentKind;
  readonly document: PartnerDocument | undefined;
  readonly settled: boolean;
  readonly chosen: File | undefined;
  readonly onPick: (file: File | undefined) => void;
}) {
  const [replacing, setReplacing] = useState(false);
  const open = !settled || replacing;

  return (
    <label className="grid gap-1">
      <span className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
        {documentKind(kind)}

        {settled ? (
          <span className="rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-[10.5px] font-bold text-ok">
            {t.contracts.uploadDone}
          </span>
        ) : (
          /*
            The asterisk is `aria-hidden` and the requirement is carried by `required` on the
            input, which is what a screen reader announces. A decorative marker read aloud as
            "star" beside every label is noise on a form that is entirely required.
          */
          <span aria-hidden="true" className="text-gold">
            *
          </span>
        )}

        {document?.status === 'rejected' ? (
          <span className="text-[10.5px] text-bad">{t.contracts.uploadAgain}</span>
        ) : null}

        {settled && !replacing ? (
          <button
            type="button"
            onClick={() => setReplacing(true)}
            className="cursor-pointer text-[10.5px] text-gold underline decoration-dotted underline-offset-2"
          >
            {t.contracts.uploadReplace}
          </button>
        ) : null}
      </span>

      {open ? (
        <input
          type="file"
          /*
            Required only while OUTSTANDING. A replacement is optional by definition — the document
            is already there — and marking it required would block the form on a field the partner
            opened by accident.
          */
          required={!settled && !chosen}
          accept="image/jpeg,image/png,application/pdf"
          onChange={(event) => onPick(event.target.files?.[0] ?? undefined)}
          className="min-h-10 cursor-pointer rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-text lg:min-h-0"
        />
      ) : null}
    </label>
  );
}
