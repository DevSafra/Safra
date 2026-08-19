'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { PARTNER_DOCUMENT_KINDS } from '@safra/contracts';

import { documentKind, t } from '@/lib/strings';

/**
 * Sending SAFRA a verification document (step 5 of «انضم كشريك», Bashar 2026-08-19).
 *
 * ## The kind is a CLOSED list
 *
 * `PARTNER_DOCUMENT_KINDS` from the contracts package, so the select cannot offer a kind the API
 * would reject — and cannot offer a free-text one. The verification queue exists to answer "has
 * this partner proved who they are"; a kind nobody recognises just sits in it looking like
 * progress.
 *
 * ## The bytes go through the API, not to a bucket
 *
 * A presigned upload would land an unvalidated object next to other partners' identity documents.
 * `multipart/form-data` here, so the API sees the file, checks it and decides — the same choice
 * property images make, for a more sensitive file.
 */
export function DocumentUpload() {
  const router = useRouter();

  const [kind, setKind] = useState<string>(PARTNER_DOCUMENT_KINDS[0]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!file) return;

    setBusy(true);
    setError(null);

    try {
      const body = new FormData();

      body.set('kind', kind);
      body.set('file', file);

      const response = await fetch('/api/documents', { method: 'POST', body });

      if (!response.ok) {
        setError(t.contracts.uploadFailed);

        return;
      }

      setFile(null);
      router.refresh();
    } catch {
      setError(t.contracts.uploadFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid gap-3 rounded-xl border border-line bg-field p-3.5"
    >
      <label className="grid gap-1">
        <span className="text-[11.5px] text-muted">{t.contracts.documentKind}</span>
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          className="min-h-10 cursor-pointer rounded-lg border border-line bg-card px-3 text-[12.5px] text-text lg:min-h-0 lg:py-2"
        >
          {PARTNER_DOCUMENT_KINDS.map((value) => (
            <option key={value} value={value}>
              {documentKind(value)}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1">
        <span className="text-[11.5px] text-muted">{t.contracts.file}</span>
        {/*
          `accept` is a courtesy to the file picker and nothing more — the API checks the bytes.
          A partner on a phone photographing a passport gets the camera, which is the common case.
        */}
        <input
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="min-h-10 cursor-pointer rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-text lg:min-h-0"
        />
      </label>

      {error ? <p className="text-[11.5px] text-bad">{error}</p> : null}

      <button
        type="submit"
        disabled={busy || !file}
        className="min-h-10 w-fit cursor-pointer rounded-lg bg-[linear-gradient(135deg,#F0CB7C,#C4923E)] px-5 text-[12.5px] font-extrabold text-[#241A05] disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0 lg:py-2"
      >
        {busy ? t.contracts.uploading : t.contracts.upload}
      </button>
    </form>
  );
}
