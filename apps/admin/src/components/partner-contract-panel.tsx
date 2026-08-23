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
  allowJointUpload = false,
}: {
  readonly partnerReference: string;
  readonly contracts: readonly ContractItem[];
  /**
   * Offer the JOINT upload — one scan carrying both signatures (Bashar, 2026-08-23).
   *
   * Off by default, and the partner detail screen leaves it off. It belongs to the in-person
   * onboarding flow: both people at one table, one sheet, no send and no return trip.
   *
   * The caller passes `canFileJointContract(partner.verification)` — the SAME predicate the API
   * refuses on — rather than `true`. That matters because the onboarding screen is reachable for
   * any partner and approval happens on it, one step below this panel: a screen that decided for
   * itself would keep offering the button after an approval the server had already begun
   * refusing, and the operator would press a visible control and get a coded refusal for a reason
   * nothing on the page hinted at.
   */
  readonly allowJointUpload?: boolean;
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
  /*
    Whether the in-person button is offered at all.

    Both conditions, in one place: the caller opted in (only the onboarding screen does) AND there
    is a live contract to sign. `allowJointUpload` already carries the API's own predicate —
    `canFileJointContract` — so this adds no second opinion about WHO may file one, only about
    whether there is anything to file it against.
  */
  const current = contracts.find(
    (contract) =>
      contract.status === 'draft' ||
      contract.status === 'awaiting_partner_signature' ||
      contract.status === 'active',
  );

  const joint =
    allowJointUpload &&
    current !== undefined &&
    current.status !== 'superseded' &&
    current.status !== 'terminated';

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

  /** `readAsDataURL` yields `data:application/pdf;base64,…`; the payload follows the FIRST comma. */
  async function base64Of(chosen: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
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
  }

  async function uploadSigned(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!file || !current) return;

    await post(`/api/contracts/${current.id}/signed-copy`, {
      fileName: file.name,
      content: await base64Of(file),
    });
  }

  /* The in-person path: one document, both signatures, straight to «ساري المفعول». */
  /**
   * The same scan, filed as the copy BOTH parties signed.
   *
   * Reads the SAME `file` as `uploadSigned` and differs only in the route. It had its own field
   * and its own form; Bashar asked for the button to sit BESIDE the existing one, and two file
   * pickers carrying the same label on one card made the operator choose which box to put one PDF
   * into — a choice with no meaning, since the document is identical either way. What differs is
   * what SAFRA is asserting about it, and that is what a button is for.
   */
  async function uploadJoint(): Promise<void> {
    if (!file || !current) return;

    await post(`/api/contracts/${current.id}/joint-signed-copy`, {
      fileName: file.name,
      content: await base64Of(file),
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

          {/*
            Two destinations for ONE file, side by side (Bashar, 2026-08-23).

            The scan is the same document; what differs is what SAFRA asserts about it. «ارفع
            النسخة الموقّعة وأرسلها للشريك» says only SAFRA has signed and the partner is next;
            «ارفع النسخة الموقّعة من سفرة والشريك» says both signatures are on this sheet and the
            contract is in force. So it is one field and two buttons, not two forms — a second
            picker would ask the operator to choose a box before choosing a meaning.

            `flex-wrap`, so the pair stacks at 390px rather than widening the card, which on the
            onboarding screen is already the narrowest thing on the page.
          */}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy || !file}
              className="w-fit cursor-pointer rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy
                ? t.sections.partnerContract.uploading
                : t.sections.partnerContract.uploadSigned}
            </button>

            {/*
              `type="button"`, deliberately: Enter in the file field submits the ORDINARY upload.
              This one puts a contract in force, and that should be a click rather than something
              a keystroke can reach by accident.
            */}
            {joint ? (
              <button
                type="button"
                disabled={busy || !file}
                onClick={() => void uploadJoint()}
                className="w-fit cursor-pointer rounded-lg bg-ok px-3 py-1.5 text-xs font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy
                  ? t.sections.partnerContract.uploading
                  : t.sections.partnerContract.uploadJoint}
              </button>
            ) : null}
          </div>

          {joint ? (
            <p className="text-[11px] leading-relaxed text-faint2">
              {t.sections.partnerContract.uploadJointHint}
            </p>
          ) : null}

          {/*
            One warning per button, and only when it has something to destroy.

            They are different losses: replacing SAFRA's copy takes the partner's signature with it
            and hands the step back to them; a joint upload replaces BOTH signatures and the
            contract stays in force. A single sentence covering both would be wrong for whichever
            button the operator pressed.
          */}
          {current.status === 'active' ? (
            <p className="text-[11px] leading-relaxed text-gold">
              {t.sections.partnerContract.replaceWarning}
            </p>
          ) : null}

          {joint && current.status !== 'draft' ? (
            <p className="text-[11px] leading-relaxed text-gold">
              {t.sections.partnerContract.uploadJointReplaceWarning}
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
 * Renders from the first copy on file; nothing at all only when no copy exists yet.
 */
function ContractHistory({ contract }: { readonly contract: ContractItem }) {
  /*
    Shown from the FIRST entry (Bashar, 2026-08-23).

    This used to be gated at two, on the reasoning that one copy is not a history and the card's
    own date already says when it arrived. Bashar overruled it after seeing the onboarding screen
    directly after SAFRA's upload: there is exactly one entry at that moment, so the whole box
    vanished and the operator saw blank space where the record should be — which reads as a missing
    feature rather than as an empty one. One thin row saying «أرسلت سفرة نسخة موقّعة · الحالية» tells
    them the record exists and is being kept.

    Do not re-add the gate.
  */
  if (contract.history.length === 0) return null;

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
