'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { statusTone } from '@safra/ui';

import type { ContractItem } from '@/lib/api';
import { Chip } from '@/components/admin-table';
import { t } from '@/lib/strings';

/**
 * The contract, on the partner's own page (Bashar, 2026-08-21).
 *
 * ## Where it sits, and why
 *
 * Directly under the documents. That is the order Bashar described the work in — review what they
 * sent, then draw up the agreement — and it is also the order the platform enforces: a contract is
 * the last thing standing between a reviewed partner and an approved one.
 *
 * The registry's `ContractsCard` lists contracts across partners and stays as it is. This is the
 * one place a contract is *acted on*, because acting on it needs the partner in front of you.
 *
 * ## Three physical verbs, in order
 *
 * Electronic signatures are not accepted in Syria, so signing involves a printer: generate,
 * download and sign, upload the scan. Each state shows only the control that state allows, and a
 * sentence saying whose turn it is — the question an operator actually arrives with is "am I
 * waiting for them, or are they waiting for me".
 *
 * ## Every button is a POST through this app's own route
 *
 * The access token lives in an HttpOnly cookie and never reaches client JavaScript; the routes
 * under `/api/contracts` attach it server-side. Downloads are plain anchors for the same reason
 * the partner portal's are — the browser handles a PDF better than any fetch would, and the route
 * carries the session.
 */
export function PartnerContractPanel({
  partnerReference,
  contracts,
}: {
  readonly partnerReference: string;
  readonly contracts: readonly ContractItem[];
}) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  /*
    Bumped after every successful upload, and used as the file input's `key` so React REMOUNTS it.

    A file input is uncontrolled — clearing `file` state leaves the chosen filename sitting in the
    DOM. Now that SAFRA can upload more than once that is not cosmetic: the field says
    «signed.pdf» while the submit button is disabled, and choosing the SAME file again fires no
    `change` event, so the panel looks broken to somebody correcting a scan. Remounting gives the
    second upload an empty field, which is also what says the first one finished.
  */
  const [uploads, setUploads] = useState(0);

  /*
    The one that matters is the newest non-terminal contract. A superseded or terminated row is
    history, and offering a control against it would let somebody sign a document that has already
    been replaced.
  */
  const current = contracts.find(
    (contract) =>
      contract.status === 'draft' ||
      contract.status === 'awaiting_partner_signature' ||
      contract.status === 'active',
  );

  async function post(path: string, body: unknown): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        /*
          The API's own code where it has one. A 413 is the case worth naming: the generic
          «تعذّر تنفيذ الطلب» sent Bashar looking for a broken feature when the answer was that
          the file was too big, which is a thing he could have acted on immediately.
        */
        const body: unknown = await response.json().catch(() => null);
        const code =
          typeof body === 'object' && body !== null && 'code' in body
            ? /* `'code' in body` already narrows it; an assertion here is redundant. */
              String(body.code)
            : null;

        setError(
          code === 'request.body_too_large'
            ? t.sections.partnerContract.tooLarge
            : t.sections.partnerContract.failed,
        );
        setBusy(false);

        return;
      }

      setFile(null);
      setUploads((n) => n + 1);
      router.refresh();
      setBusy(false);
    } catch {
      setError(t.sections.partnerContract.failed);
      setBusy(false);
    }
  }

  async function uploadSigned(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!file || !current) return;

    /* `readAsDataURL` yields `data:application/pdf;base64,…`; the payload follows the first comma. */
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = () => reject(new Error('read failed'));
      reader.onload = () => {
        /* `readAsDataURL` always yields a string; the union exists for `readAsArrayBuffer`. */
        const result = typeof reader.result === 'string' ? reader.result : '';
        const comma = result.indexOf(',');

        resolve(comma === -1 ? '' : result.slice(comma + 1));
      };
      reader.readAsDataURL(file);
    });

    await post(`/api/contracts/${current.id}/signed-copy`, {
      fileName: file.name,
      content,
    });
  }

  const state = !current
    ? null
    : current.status === 'draft'
      ? t.sections.partnerContract.stateDraft
      : current.status === 'awaiting_partner_signature'
        ? t.sections.partnerContract.stateAwaitingPartner
        : t.sections.partnerContract.stateActive;

  return (
    <div
      data-contract-status={current?.status ?? 'none'}
      className="rounded-lg border border-line bg-card p-4"
    >
      <p className="text-[12.5px] leading-relaxed text-muted">
        {current ? state : t.sections.partnerContract.intro}
      </p>

      {error ? (
        <p role="alert" className="mt-3 text-xs text-bad">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/*
          Generating, at any point in the contract's life (Bashar, 2026-08-23).

          It used to be offered only before the contract was sent, on the reasoning that
          regenerating afterwards would supersede a document the partner might already be signing
          with no way to tell them. That reasoning no longer holds: SAFRA's signed copy is what
          sends a contract, and every send emails the partner — so a replacement announces itself.

          The superseded rows stay visible to both sides, which is what makes a corrected contract
          legible rather than a document that silently changed.
        */}
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void post('/api/contracts/generate', { partnerReference, kind: 'base' })
          }
          className="cursor-pointer rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy
            ? t.sections.partnerContract.generating
            : current
              ? t.sections.partnerContract.regenerate
              : t.sections.partnerContract.generate}
        </button>

        {current ? (
          <a
            href={`/api/contracts/${current.id}/file/original`}
            className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-xs text-muted hover:border-gold/50 hover:text-gold lg:min-h-0 lg:py-1.5"
          >
            {t.sections.partnerContract.download}
          </a>
        ) : null}

        {/* The signed scans, once each exists. Their presence IS the record of the step. */}
        {current && current.status !== 'draft' ? (
          <a
            href={`/api/contracts/${current.id}/file/safra`}
            className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-xs text-muted hover:border-gold/50 hover:text-gold lg:min-h-0 lg:py-1.5"
          >
            {t.sections.partnerContract.downloadSafra}
          </a>
        ) : null}

        {current?.status === 'active' ? (
          <a
            href={`/api/contracts/${current.id}/file/partner`}
            className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-xs text-muted hover:border-gold/50 hover:text-gold lg:min-h-0 lg:py-1.5"
          >
            {t.sections.partnerContract.downloadPartner}
          </a>
        ) : null}

        {/*
          Handing the step back, offered only on a signed contract (Bashar, 2026-08-21).

          For when the partner uploaded the wrong scan and the two of them have spoken. Before
          `active` there is nothing to hand back: in `draft` it is SAFRA's turn, and in
          `awaiting_partner_signature` the partner can already upload.
        */}
        {current?.status === 'active' ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void post(`/api/contracts/${current.id}/reopen`, {})}
            className="cursor-pointer rounded-lg border border-gold/50 px-3 py-1.5 text-xs text-gold hover:bg-gold hover:text-bg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy
              ? t.sections.partnerContract.reopening
              : t.sections.partnerContract.reopen}
          </button>
        ) : null}
      </div>

      {/* What the button will do, said before it is pressed rather than after. */}
      {current?.status === 'active' ? (
        <p className="mt-2 text-[11px] leading-relaxed text-faint2">
          {t.sections.partnerContract.reopenHint}
        </p>
      ) : null}

      {/*
        SAFRA's signed copy, uploadable MORE THAN ONCE (Bashar, 2026-08-23).

        Offered in every live state, not only `draft`. A first attempt can be the wrong page or an
        unreadable scan, and the previous remedy — regenerate the whole contract — threw the terms
        away to correct a photograph.

        Replacing it after the partner has signed supersedes their signature too and returns the
        contract to their step: they signed a document that is no longer the one on file. The hint
        below says so before the file is chosen.
      */}
      {current && current.status !== 'superseded' && current.status !== 'terminated' ? (
        <form
          onSubmit={(event) => void uploadSigned(event)}
          className="mt-3 grid gap-2 rounded-lg border border-line2 bg-field p-3"
        >
          <label className="grid gap-1">
            <span className="text-[11px] text-faint2">
              {t.sections.partnerContract.file}
            </span>
            <input
              key={uploads}
              type="file"
              accept="application/pdf"
              required
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="min-h-10 cursor-pointer rounded-lg border border-line bg-card px-3 py-2 text-xs text-text lg:min-h-0"
            />
          </label>

          <button
            type="submit"
            disabled={busy || !file}
            className="w-fit cursor-pointer rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy
              ? t.sections.partnerContract.uploading
              : t.sections.partnerContract.uploadSigned}
          </button>

          {/* Only when there is a signature to invalidate — otherwise it is a warning about nothing. */}
          {current.status === 'active' ? (
            <p className="text-[11px] leading-relaxed text-gold">
              {t.sections.partnerContract.replaceWarning}
            </p>
          ) : null}
        </form>
      ) : null}

      {/*
        The version history, directly under the upload form — the same list, in the same place, as
        the partner's own screen (Bashar, 2026-08-23).

        Both sides reading the same record is the point: an operator about to replace a copy can
        see how many times it has already been replaced and whether the partner has signed since,
        which is exactly what makes the «رفع نسخة جديدة الآن يُلغي توقيع الشريك» warning above it
        concrete rather than abstract.
      */}
      {current ? <ContractHistory contract={current} /> : null}
    </div>
  );
}

/**
 * What happened to this contract, newest first.
 *
 * Renders nothing below two entries: with a single copy on file the panel's own state line already
 * says everything, and a heading over one row is furniture.
 */
function ContractHistory({ contract }: { readonly contract: ContractItem }) {
  if (contract.history.length < 2) return null;

  return (
    <div className="mt-3 grid gap-1.5 rounded-lg border border-line2 bg-field px-3 py-2.5">
      <p className="text-[11px] font-bold text-muted">
        {t.sections.partnerContract.historyTitle}
      </p>

      <ol className="grid gap-1">
        {contract.history.map((event, index) => (
          <li
            /* Index: these carry no id, and the list is server-ordered and static. */
            key={index}
            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]"
          >
            <span className={event.superseded ? 'text-faint2' : 'text-text2'}>
              {event.party === 'partner'
                ? t.sections.partnerContract.historyPartner
                : t.sections.partnerContract.historySafra}
            </span>
            <span className="text-faint2">{event.at}</span>
            {/*
              `Chip`, not `StatusPill`: these are states of a ROW in this list, not statuses of a
              record, and `StatusPill` would enrol them in the console's status colour sweep.

              «مُستبدلة» borrows the superseded status tone so the same idea is the same colour
              here as everywhere; «الحالية» is teal because this screen already paints «ساري
              المفعول» green and the sanctions pill teal — and teal is not a contract status, so
              the two never appear as competing answers to the same question.
            */}
            <Chip tone={event.superseded ? statusTone('superseded') : 'teal'}>
              {event.superseded
                ? t.sections.partnerContract.historySuperseded
                : t.sections.partnerContract.historyCurrent}
            </Chip>
          </li>
        ))}
      </ol>
    </div>
  );
}
