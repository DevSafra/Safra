'use client';

import { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { PARTNER_DOCUMENT_KINDS } from '@safra/contracts';

import { text } from '@/lib/form';
import { apiError, fill, label, t } from '@/lib/strings';

/**
 * Staff filing a partner's verification document, during an in-person onboarding
 * (Bashar, 2026-08-23).
 *
 * ## Why a staff-side upload exists at all
 *
 * Because of where onboarding now happens. A super admin sitting with a partner has the passport
 * and the commercial register ON THE TABLE; sending that partner home to find an inbox, redeem an
 * invitation and upload them is exactly the round trip the in-person flow removes.
 *
 * ## It posts to the same service the partner's own upload does
 *
 * So the file goes through the same controls — the type is proved by looking at the BYTES, images
 * are re-encoded to strip EXIF (a phone photo of an ID carries the coordinates of wherever it was
 * taken), the storage key is generated and never derived from the filename. Nothing about those is
 * restated here, and this component could not weaken them if it tried.
 *
 * What this side does add is the ACTOR: the audit entry carries the super admin's account, so the
 * log distinguishes "the partner sent this" from "a super admin filed it for them" without a flag
 * saying so.
 *
 * ## The input is cleared on success
 *
 * Five documents are uploaded one after another in a single sitting, and a file input that keeps
 * its previous selection makes the second upload look like it worked when it re-sent the first.
 */
export function PartnerDocumentUpload({ reference }: { reference: string }) {
  const router = useRouter();
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(data: FormData): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);
    setDone(null);

    const kind = text(data, 'kind');
    const file = data.get('file');

    if (!(file instanceof File) || file.size === 0) {
      setError(t.sections.partnerOnboarding.uploadFailed);
      setBusy(false);

      return;
    }

    try {
      /*
        The `FormData` is rebuilt rather than posted as it came off the form, for the same reason
        the route handler rebuilds it: two named fields, and nothing else travels.
      */
      const body = new FormData();
      body.set('kind', kind);
      body.set('file', file, file.name);

      const response = await fetch(
        `/api/partners/${encodeURIComponent(reference)}/documents`,
        { method: 'POST', body },
      );

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);

        setError(apiError(messageOf(payload)));
        setBusy(false);

        return;
      }

      setDone(fill(t.sections.partnerOnboarding.uploaded, { kind: kindLabel(kind) }));
      form.current?.reset();
      /* The list of uploaded documents lives on the server component above this one. */
      router.refresh();
      setBusy(false);
    } catch {
      setError(t.sections.partnerOnboarding.unreachable);
      setBusy(false);
    }
  }

  return (
    <form
      ref={form}
      className="grid gap-3 rounded-lg border border-line bg-card p-4 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(new FormData(event.currentTarget));
      }}
    >
      <div className="grid gap-1.5">
        <label
          htmlFor={`${formId}-kind`}
          className="text-[11.5px] font-semibold text-muted"
        >
          {t.sections.partnerOnboarding.documentKind}
        </label>
        <select
          id={`${formId}-kind`}
          name="kind"
          required
          defaultValue={PARTNER_DOCUMENT_KINDS[0]}
          className="cursor-pointer rounded-[9px] border border-line bg-field px-3 py-2.5 text-[13px] font-normal text-text"
        >
          {PARTNER_DOCUMENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kindLabel(kind)}
            </option>
          ))}
        </select>
      </div>

      {/*
        The hint is a DESCRIPTION, not part of the field's name — see the note on `Field` in
        `onboard-partner-form.tsx`. Inside the `<label>` it would be announced every time the
        field is reached, and it would make «الملف» match by substring wherever that word appears.
      */}
      <div className="grid gap-1.5">
        <label
          htmlFor={`${formId}-file`}
          className="text-[11.5px] font-semibold text-muted"
        >
          {t.sections.partnerOnboarding.documentFile}
        </label>
        <input
          id={`${formId}-file`}
          name="file"
          type="file"
          required
          accept="image/jpeg,image/png,image/webp,application/pdf"
          aria-describedby={`${formId}-file-hint`}
          className="min-h-10 cursor-pointer rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] font-normal text-text lg:min-h-0"
        />
        <span id={`${formId}-file-hint`} className="text-[10.5px] font-normal text-faint">
          {t.sections.partnerOnboarding.documentFileHint}
        </span>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-line px-4 py-2 text-sm text-text hover:border-ok/50 hover:text-ok disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
      >
        {busy
          ? t.sections.partnerOnboarding.uploading
          : t.sections.partnerOnboarding.upload}
      </button>

      {error ? (
        <p role="alert" className="text-[12px] text-bad sm:col-span-3">
          {error}
        </p>
      ) : null}

      {done ? (
        <p role="status" className="text-[12px] text-ok sm:col-span-3">
          {done}
        </p>
      ) : null}
    </form>
  );
}

/** «وثيقة هوية» rather than `identity`. An unknown kind falls back to the raw key by design. */
function kindLabel(kind: string): string {
  return label(t.enums.documentKind, kind);
}

function messageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('message' in body)) return null;

  const { message } = body;

  return typeof message === 'string' ? message : null;
}
