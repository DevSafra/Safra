import Link from 'next/link';

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
 * ## Signing is offline, and the screen says so
 *
 * There is no "I have signed this" button, because a partner asserting their own signature is not
 * a signature. They download it, sign it, return it, and SAFRA records that — which is the
 * `awaiting_partner_signature → active` transition on the staff side.
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
  const approved = documents.filter((d) => d.status === 'approved').length;
  const rejected = documents.filter((d) => d.status === 'rejected').length;

  /*
    Which KINDS have arrived and not been sent back. `documents` is newest-first, so the first row
    for a kind is the one that describes where it stands — a replaced passport leaves two.
  */
  const settled = new Set(
    PARTNER_DOCUMENT_KINDS.filter((kind) => {
      const newest = documents.find((document) => document.kind === kind);

      return newest !== undefined && newest.status !== 'rejected';
    }),
  );

  /*
    The stage, in the order a partner meets it.

    `rejected` outranks `waiting` on purpose: a partner with two documents under review and one
    sent back has something to DO, and «لا حاجة لأي إجراء منك الآن» would be false for exactly the
    person who needs to act.

    `partial` exists because all five kinds became required on 2026-08-21. Counting ROWS rather
    than kinds would call a partner who sent two of five "waiting", which is the same false
    reassurance one step earlier.
  */
  const stage: Stage =
    verification === 'approved'
      ? 'done'
      : rejected > 0 || verification === 'rejected'
        ? 'fix'
        : documents.length === 0
          ? 'empty'
          : settled.size < PARTNER_DOCUMENT_KINDS.length
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
              sent: documents.length,
              approved,
              rejected,
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
        The way out, on the panel that announces it. A partner told «اكتمل التحقق» and left on the
        page they have been staring at for days has to work out for themselves that the sidebar
        just grew five links.
      */}
      {stage === 'done' ? (
        <Link
          href="/"
          className="mt-3 inline-flex min-h-10 w-fit items-center rounded-lg bg-[linear-gradient(135deg,#F0CB7C,#C4923E)] px-5 text-[12.5px] font-extrabold text-[#241A05] lg:min-h-0 lg:py-2"
        >
          {t.contracts.stageDoneCta}
        </Link>
      ) : null}
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
        {t.contracts.download}
      </a>

      {contract.status === 'awaiting_partner_signature' ? (
        <p className="text-[11.5px] leading-relaxed text-faint">{t.contracts.signHint}</p>
      ) : null}
    </li>
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
