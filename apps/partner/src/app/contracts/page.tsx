import { PARTNER_DOCUMENT_KINDS } from '@safra/contracts';
import { statusTone } from '@safra/ui';

import {
  getMyContracts,
  getMyDocuments,
  getMyProfile,
  sidebarBadges,
  type PartnerContract,
  type PartnerDocument,
} from '@/lib/api';
import { isLocked } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { Ltr } from '@/components/ltr';
import { count } from '@/lib/format';
import { ContractSigning } from '@/components/contract-signing';
import { DocumentUpload } from '@/components/document-upload';
import { TONES } from '@/lib/tones';
import {
  contractKind,
  contractStatus,
  documentKind,
  fill,
  t,
  verificationStatus,
} from '@/lib/strings';

/**
 * العقود والمستندات — steps 4, 5 and 6 of «انضم كشريك» (Bashar, 2026-08-19).
 *
 * ## Since 2026-08-21 this is the ONBOARDING screen, not merely a section
 *
 * Until SAFRA verifies a partner it is the only page in the portal — `requireVerifiedPartner`
 * sends every other route here and the sidebar drops to two links. That changed what this page
 * has to do. It used to be a reference screen a partner might visit; now it is the first thing
 * they see after their first sign-in, and often the only thing they will see for days.
 *
 * So it opens with a three-step progress line and ONE stage panel that says what to do right now.
 * The panel is derived from the documents rather than chosen by hand: nothing sent, everything
 * sent and waiting, something rejected, or done. A partner who cannot tell which of those they are
 * in assumes the process has stalled and opens a support ticket — which is the expensive failure
 * this page exists to prevent.
 *
 * ## Why the contract and the documents share one screen
 *
 * They are the two things standing between an accepted application and a verified account, and
 * they are due at the same time: SAFRA sends a contract to sign, and asks for documents to check.
 * A partner who has done one and not the other is stuck, and two screens make that easy to not
 * notice.
 *
 * ## Signing is on PAPER, and the return trip happens here
 *
 * There is still no "I have signed this" button — a partner asserting their own signature is not a
 * signature, and electronic signatures are not accepted in Syria in any case (Bashar, 2026-08-21).
 * What changed is where the paper goes: the partner downloads the contract, signs it by hand,
 * scans it, and uploads the scan on this screen. That upload is what makes the contract `active`
 * and what tells the super admins, rather than a staff member recording it by hand afterwards.
 *
 * ## The banner is the same fact the API enforces
 *
 * «قبل التحقق … لا يمكنك إضافة الأسعار أو التواريخ أو الصور» describes `RequireVerifiedPartner`
 * and the `initialUnits` check in `PropertiesService.create`, not a UI preference. The API refuses
 * those writes whatever this page says; this page exists so the refusal is expected rather than
 * surprising.
 */
export const dynamic = 'force-dynamic';

/** The per-file cap the API enforces on a document upload. Stated where it is asked for. */
const MAX_UPLOAD_MB = 10;

/** The stage the account is in, decided once and rendered once. */
type Stage = 'empty' | 'partial' | 'waiting' | 'fix' | 'done';

export default async function ContractsPage() {
  const [profile, contractsResult, documentsResult] = await Promise.all([
    getMyProfile(),
    getMyContracts(),
    getMyDocuments(),
  ]);

  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;
  const locked = isLocked(profile);

  const shell = (children: React.ReactNode) => (
    <Shell
      title={locked ? t.contracts.onboardingTitle : t.contracts.title}
      partnerName={name}
      active="contracts"
      badges={sidebarBadges(profile)}
      locked={locked}
    >
      <div className="mx-auto grid w-full max-w-[760px] gap-5">{children}</div>
    </Shell>
  );

  if (contractsResult === 'unauthenticated' || documentsResult === 'unauthenticated') {
    return shell(<p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>);
  }

  if (contractsResult === 'failed' || documentsResult === 'failed') {
    return shell(<p className="text-sm text-muted">{t.contracts.loadFailed}</p>);
  }

  const verification =
    profile === 'failed' || profile === 'unauthenticated'
      ? 'pending'
      : profile.verification;

  const documents = documentsResult.documents;

  /*
    Everything on this screen is about KINDS, not about rows.

    `partner_documents` is append-only: replacing a rejected passport adds a row and leaves the
    rejected one where it was. So the state of a kind is the state of its NEWEST row — the list
    arrives `ORDER BY created_at DESC`, so that is the first match — and any count taken over rows
    describes history rather than the present.

    That distinction is the bug Bashar reported on 2026-08-21: the stage was chosen by
    `documents.filter(d => d.status === 'rejected').length > 0`, which counts rows. Once ANY
    document had ever been rejected the partner was told «مستند يحتاج إعادة إرسال» for ever — after
    they had replaced it, and after a reviewer had approved the replacement. The panel described a
    row nobody could act on, on a screen whose only job is to say what to do next.
  */
  const newestByKind = new Map(
    PARTNER_DOCUMENT_KINDS.map((kind) => [
      kind,
      documents.find((document) => document.kind === kind),
    ]),
  );

  const states = [...newestByKind.values()];

  /** Sent and not sent back — the kind needs nothing further. */
  const settled = states.filter(
    (newest) => newest !== undefined && newest.status !== 'rejected',
  ).length;
  const approved = states.filter((newest) => newest?.status === 'approved').length;
  /** The kind's LATEST attempt was rejected, so this one is the partner's to act on. */
  const needsResend = states.filter((newest) => newest?.status === 'rejected').length;
  const sentKinds = states.filter((newest) => newest !== undefined).length;

  /*
    The stage, in the order a partner meets it.

    `fix` outranks `waiting` on purpose: a partner with two documents under review and one sent
    back has something to DO, and «لا حاجة لأي إجراء منك الآن» would be false for exactly the
    person who needs to act.

    `partial` exists because all five kinds became required on 2026-08-21.
  */
  const stage: Stage =
    verification === 'approved'
      ? 'done'
      : needsResend > 0 || verification === 'rejected'
        ? 'fix'
        : documents.length === 0
          ? 'empty'
          : settled < PARTNER_DOCUMENT_KINDS.length
            ? 'partial'
            : 'waiting';

  return shell(
    <>
      {locked ? <Steps stage={stage} /> : null}

      <StagePanel stage={stage} />

      {/*
        What is asked for, listed BEFORE the form. It was only in the «انضم كشريك» page on the
        customer site — a page the partner saw once, days earlier, before they had an account.
      */}
      {stage === 'empty' || stage === 'partial' || stage === 'fix' ? <Needed /> : null}

      {verification === 'approved' ? null : (
        <section>
          <h2 className="mb-2 text-[14.5px] font-extrabold text-gold">
            {t.contracts.uploadTitle}
          </h2>
          <DocumentUpload sent={documents} />
        </section>
      )}

      <section>
        <h2 className="mb-2 text-[14.5px] font-extrabold text-gold">
          {t.contracts.contractsTitle}
        </h2>

        {contractsResult.contracts.length === 0 ? (
          <p className="text-[12.5px] text-faint2">{t.contracts.contractsEmpty}</p>
        ) : (
          <ul className="grid gap-2">
            {contractsResult.contracts.map((contract) => (
              <ContractCard key={contract.id} contract={contract} />
            ))}
          </ul>
        )}
      </section>

      {documents.length === 0 ? null : (
        <section>
          <h2 className="mb-1 text-[14.5px] font-extrabold text-gold">
            {t.contracts.documentsTitle}
          </h2>
          <p className="mb-3 text-[12px] text-faint">
            {fill(t.contracts.countSent, {
              sent: sentKinds,
              total: PARTNER_DOCUMENT_KINDS.length,
              approved,
              rejected: needsResend,
            })}
          </p>

          <ul className="grid gap-2">
            {documents.map((document) => (
              <DocumentCard key={document.id} document={document} />
            ))}
          </ul>
        </section>
      )}

      {locked ? (
        <p className="text-[11.5px] text-faint2">{t.contracts.lockedNote}</p>
      ) : null}
    </>,
  );
}

/**
 * Where the partner is, in three steps.
 *
 * Shown only while locked. Once verified this page is an ordinary section and a progress line
 * pointing at a finished process is noise.
 */
function Steps({ stage }: { readonly stage: Stage }) {
  const reached = stage === 'done' ? 3 : stage === 'waiting' ? 2 : 1;

  const labels = [t.contracts.stepUpload, t.contracts.stepReview, t.contracts.stepReady];

  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[12px]">
      {labels.map((label, index) => {
        const step = index + 1;
        const state = step < reached ? 'past' : step === reached ? 'now' : 'ahead';

        return (
          <li key={label} className="flex items-center gap-2">
            <span
              data-step-state={state}
              className={`inline-flex min-h-7 items-center gap-2 rounded-full border px-3 py-1 font-bold ${
                state === 'now'
                  ? 'border-gold bg-[rgba(var(--goldA),0.12)] text-gold'
                  : state === 'past'
                    ? 'border-ok/40 bg-ok/5 text-ok'
                    : 'border-line bg-card text-faint2'
              }`}
            >
              {/*
                The number is a numeral, not a tick even when past: «٢» beside «١ ✓» reads as two
                different kinds of thing. Arabic-Indic, like every other number in this app.
              */}
              <span className="tabular-nums">{count(step)}</span>
              {label}
            </span>
            {/*
              A separator, hidden from the accessibility tree — it carries no meaning that the
              order of the list does not already carry, and read aloud it is three stray dashes.
            */}
            {step < labels.length ? (
              <span aria-hidden="true" className="text-faint2">
                ―
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** The one panel that says what to do right now. */
function StagePanel({ stage }: { readonly stage: Stage }) {
  const copy =
    stage === 'done'
      ? { title: t.contracts.stageDoneTitle, body: t.contracts.stageDoneBody, tone: 'ok' }
      : stage === 'fix'
        ? {
            title: t.contracts.stageFixTitle,
            body: t.contracts.stageFixBody,
            tone: 'bad',
          }
        : stage === 'waiting'
          ? {
              title: t.contracts.stageWaitingTitle,
              body: t.contracts.stageWaitingBody,
              tone: 'gold',
            }
          : stage === 'partial'
            ? {
                title: t.contracts.stagePartialTitle,
                body: t.contracts.stagePartialBody,
                tone: 'gold',
              }
            : {
                title: t.contracts.stageEmptyTitle,
                body: t.contracts.stageEmptyBody,
                tone: 'gold',
              };

  return (
    <section
      data-stage={stage}
      className={`rounded-xl border px-4 py-3.5 ${
        copy.tone === 'ok'
          ? 'border-ok/40 bg-ok/5'
          : copy.tone === 'bad'
            ? 'border-bad/40 bg-bad/5'
            : 'border-[rgba(var(--goldA),0.3)] bg-[rgba(var(--goldA),0.05)]'
      }`}
    >
      <h2 className="text-[14px] font-bold text-text">{copy.title}</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-text2">{copy.body}</p>

      {stage === 'empty' ? (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-text2">
          {t.contracts.onboardingLead}
        </p>
      ) : null}

      {/*
        No call to action on the finished panel (Bashar, 2026-08-21).

        There was one — «انتقل إلى لوحة التحكم» — on the reasoning that a partner left on this page
        might not notice the sidebar had just grown five links. Removed at Bashar's request: the
        sidebar unlocks the moment verification lands, «لوحة التحكم» is its first item, and a button
        that duplicates a nav link is a second thing to keep pointing at the right place.
      */}
    </section>
  );
}

/** What SAFRA asks for — on the screen where it is sent, not only in the application form. */
function Needed() {
  return (
    <section className="rounded-xl border border-line bg-card px-4 py-3.5">
      <h2 className="text-[13.5px] font-bold text-text">{t.contracts.neededTitle}</h2>
      <ul className="mt-2 grid gap-1.5 text-[12.5px] leading-relaxed text-text2">
        {[
          t.contracts.neededIdentity,
          t.contracts.neededRegister,
          t.contracts.neededOwnership,
          t.contracts.neededManagement,
          t.contracts.neededBank,
        ].map((line) => (
          <li key={line} className="flex gap-2">
            <span aria-hidden="true" className="text-gold">
              ―
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
      {/* The size cap the API enforces, localised through  like every other number. */}
      <p className="mt-2 text-[11.5px] text-faint">
        {fill(t.contracts.neededNote, { max: count(MAX_UPLOAD_MB) })}
      </p>
    </section>
  );
}

function ContractCard({ contract }: { readonly contract: PartnerContract }) {
  return (
    <li className="grid gap-2 rounded-xl border border-line bg-card px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[13px] font-bold text-text">
          {contractKind(contract.kind)}
        </span>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${TONES[statusTone(contract.status)]}`}
        >
          {contractStatus(contract.status)}
        </span>
        <span className="text-[11.5px] text-faint">
          {t.contracts.contractUploaded} <Ltr>{contract.uploadedAt.slice(0, 10)}</Ltr>
        </span>
        {contract.signedAt ? (
          <span className="text-[11.5px] text-faint">
            {t.contracts.contractSigned} <Ltr>{contract.signedAt.slice(0, 10)}</Ltr>
          </span>
        ) : null}
        {contract.expiresAt ? (
          <span className="text-[11.5px] text-faint">
            {t.contracts.contractExpires} <Ltr>{contract.expiresAt.slice(0, 10)}</Ltr>
          </span>
        ) : null}
      </div>

      {/*
        A plain anchor to the proxy route, not a fetch.

        The browser's own download handles a PDF better than any JavaScript would, and the route
        attaches the session cookie for us. `download` names the file the API named it.
      */}
      <a
        href={`/api/contracts/${encodeURIComponent(contract.id)}/file`}
        className="inline-flex min-h-10 w-fit items-center rounded-lg border border-gold px-4 text-[12.5px] text-gold transition-colors hover:bg-gold hover:text-bg lg:min-h-0 lg:py-2"
      >
        {/* Names which copy: after SAFRA signs, this link serves the document carrying that
            signature rather than the blank original the partner was previously given. */}
        {contract.status === 'draft' ? t.contracts.download : t.contracts.downloadSigned}
      </a>

      {/*
        The signing panel replaces the old «وقّع النسخة وأعدها إلى فريق سفرة» note.

        That note described a process the platform did not carry — the partner was told to return
        the paper by some other means, and staff recorded it by hand. The paper is the same; what
        changed is that the return trip now happens here, so the note became the form.
      */}
      <ContractSigning contractId={contract.id} status={contract.status} />

      {/*
        The version history, DIRECTLY under the form (Bashar, 2026-08-23).

        Under it rather than above because the form is the thing to act on; the history is why the
        form says what it says. A partner who has just been sent a replacement reads the form first
        and the reason second.
      */}
      <ContractHistory contract={contract} />
    </li>
  );
}

/**
 * What happened to this contract, in order (Bashar, 2026-08-23).
 *
 * ## The case it exists for
 *
 * SAFRA can replace their signed copy after the partner has already signed. That supersedes the
 * partner's signature and returns the contract to their step — and without this the partner saw
 * nothing: the same single card, quietly back to «بانتظار توقيعك», with no statement that anything
 * had changed or that their own signature no longer stood. Somebody re-signing a document they
 * believe they already signed, with no explanation on the screen, is the failure this closes.
 *
 * ## It renders nothing when there is nothing to say
 *
 * A contract with one copy on it has no history worth a heading — the card's own date already says
 * when it arrived. The block appears from the second event onward, which is exactly when the
 * single date stops being the whole story.
 */
function ContractHistory({ contract }: { readonly contract: PartnerContract }) {
  /* Newest first, ordered by the query — the copy being acted on is the one at the top. */
  if (contract.history.length < 2) return null;

  /*
    Was something the PARTNER did undone, and is it their turn again? That pair is the only case
    where the screen owes an explanation rather than a record: their own signature was superseded
    by the other side. A superseded SAFRA copy is ordinary — it is SAFRA correcting SAFRA.
  */
  const theirSignatureWasUndone =
    contract.status === 'awaiting_partner_signature' &&
    contract.history.some((event) => event.party === 'partner' && event.superseded);

  return (
    <div className="grid gap-1.5 rounded-lg border border-line2 bg-field px-3 py-2.5">
      <p className="text-[11.5px] font-bold text-text2">{t.contracts.historyTitle}</p>

      {theirSignatureWasUndone ? (
        <p className="text-[11.5px] leading-relaxed text-gold">
          {t.contracts.historyReplaced}
        </p>
      ) : null}

      <ol className="grid gap-1">
        {contract.history.map((event, index) => (
          <li
            /* Index: these have no id of their own, and the list is server-ordered and static. */
            key={index}
            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px]"
          >
            <span className={event.superseded ? 'text-faint' : 'text-text2'}>
              {event.party === 'partner'
                ? t.contracts.historyPartner
                : t.contracts.historySafra}
            </span>
            <span className="text-faint2">
              {/* Already a day — the API cuts it, so neither screen has to. */}
              <Ltr>{event.at}</Ltr>
            </span>
            {/*
              «مُستبدلة» borrows the SUPERSEDED status tone on purpose — same idea, same colour,
              which is rule 1 («a status is the same colour everywhere»).

              «الحالية» is `teal` for rule 2. This screen already paints ok, warn, slate and stone
              from the contract vocabulary and gold, lime, bad and sky from the document one; `ok`
              would have put «الحالية» in the same green as «ساري المفعول» two lines above it, and
              two different meanings in one colour on one screen is exactly what that rule forbids.
            */}
            <span
              className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${
                event.superseded ? TONES[statusTone('superseded')] : TONES.teal
              }`}
            >
              {event.superseded
                ? t.contracts.historySuperseded
                : t.contracts.historyCurrent}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function DocumentCard({ document }: { readonly document: PartnerDocument }) {
  return (
    <li className="grid gap-1 rounded-xl border border-line bg-card px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[13px] font-bold text-text">
          {documentKind(document.kind)}
        </span>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${TONES[statusTone(document.status)]}`}
        >
          {verificationStatus(document.status)}
        </span>
        <span className="text-[11.5px] text-faint">
          {t.contracts.documentUploaded} <Ltr>{document.createdAt.slice(0, 10)}</Ltr>
        </span>
      </div>

      {/*
        The reviewer's note, shown to the partner deliberately. It is what tells them what to send
        instead — a rejected document with no reason produces a support ticket, not a better upload.
      */}
      {document.reviewNotes ? (
        <p className="text-[12px] leading-relaxed text-text2">
          {t.contracts.documentNotes}: {document.reviewNotes}
        </p>
      ) : null}
    </li>
  );
}
