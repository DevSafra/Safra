'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { t } from '@/lib/strings';

/**
 * Returning the contract, signed by hand (Bashar, 2026-08-21).
 *
 * ## Three physical verbs, in order
 *
 * Electronic signatures are not accepted in Syria, so the partner's task involves a printer:
 * download, sign, upload. The panel says so before it shows the file field, because a partner who
 * picks the file first has not understood what they are being asked for — and the commonest way
 * that goes wrong is uploading the UNSIGNED contract straight back.
 *
 * ## It appears only in the one state it applies to
 *
 * `awaiting_partner_signature` and nothing else. A `draft` is a contract SAFRA has not signed yet,
 * and offering the partner a way to sign it would let them return a document with one signature on
 * it; an `active` one is already done. The API refuses both, and this is the same refusal made
 * visible rather than a second copy of the rule.
 *
 * ## The file is read in the browser and sent as base64
 *
 * Matching the API's shape, which takes base64 in JSON for contracts. `FileReader` rather than a
 * multipart form for the same reason the API does: one schema covers the whole request, and there
 * is no multipart parser in this app to keep patched.
 */
export function ContractSigning({
  contractId,
  status,
}: {
  readonly contractId: string;
  readonly status: string;
}) {
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'active') {
    return <p className="text-[11.5px] text-ok">{t.contracts.signDone}</p>;
  }

  if (status === 'draft') {
    return <p className="text-[11.5px] text-faint">{t.contracts.signWaitingSafra}</p>;
  }

  if (status !== 'awaiting_partner_signature') return null;

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!file || busy) return;

    /*
      Captured into a local so the narrowing survives the two closures below. `file` is state and
      TypeScript will not carry a narrowing across an async boundary — the assertion this replaces
      was flagged as unnecessary, which it was: this is the honest way to say the same thing.
    */
    const chosen = file;

    setBusy(true);
    setError(null);

    try {
      /*
        `readAsDataURL` gives `data:application/pdf;base64,…`; the payload is what follows the
        comma. Split on the FIRST comma only — base64 contains none, but a future data URL with
        parameters would, and a split that took the last field would silently truncate the file.
      */
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();

        reader.onerror = () => reject(new Error('read failed'));
        reader.onload = () => {
          /* `readAsDataURL` always yields a string; the union exists for `readAsArrayBuffer`. */
          const result = typeof reader.result === 'string' ? reader.result : '';
          const comma = result.indexOf(',');

          resolve(comma === -1 ? '' : result.slice(comma + 1));
        };
        reader.readAsDataURL(chosen);
      });

      const response = await fetch(`/api/contracts/${contractId}/signed-copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: chosen.name, content }),
      });

      if (!response.ok) {
        /* Name the size failure; everything else is the generic message. See the console panel. */
        const body: unknown = await response.json().catch(() => null);
        const code =
          typeof body === 'object' && body !== null && 'code' in body
            ? /* `'code' in body` already narrows it; an assertion here is redundant. */
              String(body.code)
            : null;

        setError(
          code === 'request.body_too_large'
            ? t.contracts.signTooLarge
            : t.contracts.signFailed,
        );
        setBusy(false);

        return;
      }

      setFile(null);
      router.refresh();
      setBusy(false);
    } catch {
      setError(t.contracts.signFailed);
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="mt-3 grid gap-2.5 rounded-lg border border-[rgba(var(--goldA),0.3)] bg-[rgba(var(--goldA),0.05)] p-3.5"
    >
      <p className="text-[12.5px] font-bold text-gold">{t.contracts.signTitle}</p>
      <p className="text-[11.5px] leading-relaxed text-text2">{t.contracts.signSteps}</p>

      <label className="grid gap-1">
        <span className="text-[11px] text-muted">{t.contracts.signFile}</span>
        <input
          type="file"
          accept="application/pdf"
          required
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="min-h-10 cursor-pointer rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-text lg:min-h-0"
        />
      </label>

      {error ? (
        <p role="alert" className="text-[11.5px] text-bad">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy || !file}
        className="min-h-10 w-fit cursor-pointer rounded-lg bg-[linear-gradient(135deg,#F0CB7C,#C4923E)] px-5 text-[12.5px] font-extrabold text-[#241A05] disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0 lg:py-2"
      >
        {busy ? t.contracts.signUploading : t.contracts.signUpload}
      </button>
    </form>
  );
}
