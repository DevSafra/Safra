import { statusTone } from '@safra/ui';

import {
  getMyContracts,
  getMyDocuments,
  getMyProfile,
  sidebarBadges,
  type PartnerContract,
  type PartnerDocument,
} from '@/lib/api';
import { Shell } from '@/components/shell';
import { Ltr } from '@/components/ltr';
import { DocumentUpload } from '@/components/document-upload';
import { TONES } from '@/lib/tones';
import {
  contractKind,
  contractStatus,
  documentKind,
  t,
  verificationStatus,
} from '@/lib/strings';

/**
 * العقود والمستندات — steps 4, 5 and 6 of «انضم كشريك» (Bashar, 2026-08-19).
 *
 * ## Why the contract and the documents share one screen
 *
 * They are the two things standing between an accepted application and a verified account, and
 * they are due at the same time: SAFRA sends a contract to sign, and asks for documents to check.
 * A partner who has done one and not the other is stuck, and two screens make that easy to not
 * notice. One screen, and the banner at the top says which state the account is in.
 *
 * ## Signing is offline, and the screen says so
 *
 * There is no "I have signed this" button, because a partner asserting their own signature is not
 * a signature. They download it, sign it, return it, and SAFRA records that — which is the
 * `awaiting_partner_signature → active` transition on the staff side. Said in a sentence under the
 * contract rather than left to be discovered.
 *
 * ## The banner is the same fact the API enforces
 *
 * «قبل التحقق … لا يمكنك إضافة الأسعار أو التواريخ أو الصور» describes `RequireVerifiedPartner`,
 * not a UI preference. The API refuses those writes whatever this page says; this page exists so
 * the refusal is expected rather than surprising.
 */
export const dynamic = 'force-dynamic';

export default async function ContractsPage() {
  const [profile, contractsResult, documentsResult] = await Promise.all([
    getMyProfile(),
    getMyContracts(),
    getMyDocuments(),
  ]);

  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  const shell = (children: React.ReactNode) => (
    <Shell
      title={t.contracts.title}
      partnerName={name}
      active="contracts"
      badges={sidebarBadges(profile)}
    >
      <div className="grid gap-5">{children}</div>
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

  return shell(
    <>
      <p className="text-[12.5px] leading-relaxed text-faint">{t.contracts.intro}</p>

      <VerificationBanner verification={verification} />

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

      <section>
        <h2 className="mb-1 text-[14.5px] font-extrabold text-gold">
          {t.contracts.documentsTitle}
        </h2>
        <p className="mb-3 text-[12px] leading-relaxed text-faint">
          {t.contracts.documentsIntro}
        </p>

        <DocumentUpload />

        {documentsResult.documents.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-faint2">{t.contracts.documentsEmpty}</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {documentsResult.documents.map((document) => (
              <DocumentCard key={document.id} document={document} />
            ))}
          </ul>
        )}
      </section>
    </>,
  );
}

/** Which of the three states the account is in, said in the words that state deserves. */
function VerificationBanner({ verification }: { readonly verification: string }) {
  const copy =
    verification === 'approved'
      ? { title: t.contracts.verifiedTitle, body: t.contracts.verifiedBody, tone: 'ok' }
      : verification === 'rejected'
        ? {
            title: t.contracts.rejectedTitle,
            body: t.contracts.rejectedBody,
            tone: 'bad',
          }
        : {
            title: t.contracts.pendingTitle,
            body: t.contracts.pendingBody,
            tone: 'gold',
          };

  return (
    <section
      data-verification={verification}
      className={`rounded-xl border px-4 py-3 ${
        copy.tone === 'ok'
          ? 'border-ok/40 bg-ok/5'
          : copy.tone === 'bad'
            ? 'border-bad/40 bg-bad/5'
            : 'border-[rgba(var(--goldA),0.3)] bg-[rgba(var(--goldA),0.05)]'
      }`}
    >
      <h2 className="text-[13.5px] font-bold text-text">{copy.title}</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-text2">{copy.body}</p>
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
