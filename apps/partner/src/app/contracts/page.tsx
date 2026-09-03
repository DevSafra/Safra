import { statusTone } from '@safra/ui';

import {
  getMyContracts,
  getMyProfile,
  sidebarBadges,
  type PartnerContract,
} from '@/lib/api';
import { isLocked, sectionAccess } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { Ltr } from '@/components/ltr';
import { count } from '@/lib/format';
import { ContractSigning } from '@/components/contract-signing';
import { TONES } from '@/lib/tones';
import { contractKind, contractStatus, t } from '@/lib/strings';

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

/**
 * The stage the account is in, decided once and rendered once.
 *
 * Two of the five went with المستندات on 2026-08-31 (Bashar: «We should remove this section
 * completely»): `empty` and `partial` described how much of a document set had arrived, and there
 * is no document set any more. What is left is the only question this page can still answer — is
 * SAFRA still looking, has it said no, or is the partner through.
 */
type Stage = 'waiting' | 'fix' | 'done';

export default async function ContractsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
    Set by `/api/contracts/[contractId]/file` when «تنزيل العقد» could not be served.

    The route redirects here rather than answering a body, because it is a plain `<a href>` and the
    browser renders what it gets — a partner used to meet `{"code":"contract.not_found"}`. Read as a
    flag rather than a message: a sentence in a query string is a sentence an attacker can put on
    our page.
  */
  const fileUnavailable = (await searchParams)['file'] === 'unavailable';
  /*
    The reader's ROLE decides whether this page has anything to show them at all.

    An employee does not hold `PARTNER_CONTRACT_SIGN_OWN`, so the fetch below answers 403 — which `partnerFetch` reports as `'unauthenticated'`, and the
    screen would say «انتهت الجلسة». Their session is fine; sending them to sign in again over a
    permission is advice that cannot work.

    It is worse than a wrong sentence for an employee of an UNVERIFIED partner, because the
    onboarding gate redirects every other route HERE — so the two 403s become a loop with no way
    out of it.

    Asked before the fetches rather than after, so the refusals are never made.
  */
  const [access, profile] = await Promise.all([
    sectionAccess('contracts'),
    getMyProfile(),
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
      <div className="grid gap-5">
        {fileUnavailable ? (
          <p role="alert" className="text-[12.5px] text-bad">
            {t.contracts.downloadUnavailable}
          </p>
        ) : null}
        {children}
      </div>
    </Shell>
  );

  /*
    Returned BEFORE the two fetches, so the refusals are never made rather than made and swallowed.

    `locked` picks the sentence: an employee of a partner still under review is told that, because
    the onboarding gate has sent them here from wherever they were going and «قيد المراجعة» is the
    whole of what they can usefully know. An employee of an approved partner reached this page on
    purpose, and is told it belongs to the owner.
  */
  if (access !== 'open') {
    return shell(
      <p className="text-sm leading-relaxed text-muted">
        {locked ? t.employees.employerUnderReview : t.employees.ownerOnly}
      </p>,
    );
  }

  const [contractsResult] = await Promise.all([getMyContracts()]);

  if (contractsResult === 'unauthenticated') {
    return shell(<p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>);
  }

  if (contractsResult === 'failed') {
    return shell(<p className="text-sm text-muted">{t.contracts.loadFailed}</p>);
  }

  const verification =
    profile === 'failed' || profile === 'unauthenticated'
      ? 'pending'
      : profile.verification;

  /*
    The stage, from the account's own state and nothing else.

    It was derived from how many document KINDS had arrived and whether any newest row had been
    sent back. With المستندات gone there is one fact left: what SAFRA has decided.
  */
  const stage: Stage =
    verification === 'approved'
      ? 'done'
      : verification === 'rejected'
        ? 'fix'
        : 'waiting';

  return shell(
    <>
      {locked ? <Steps stage={stage} /> : null}

      <StagePanel stage={stage} />

      <section>
        <h2 className="mb-2 text-[14.5px] font-extrabold text-gold-ink">
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
  /*
    Two steps since 2026-08-31, not three. «إرسال المستندات» was the first, and المستندات was
    removed — there is nothing for the partner to send before SAFRA decides, so a step describing
    an action they cannot take would be a progress line pointing at nothing.
  */
  const reached = stage === 'done' ? 2 : 1;

  const labels = [t.contracts.stepReview, t.contracts.stepReady];

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
        : {
            title: t.contracts.stageWaitingTitle,
            body: t.contracts.stageWaitingBody,
            tone: 'gold',
          };

  return (
    <section
      data-stage={stage}
      className={`rounded-card border px-4 py-3.5 ${
        copy.tone === 'ok'
          ? 'border-ok/40 bg-ok/5'
          : copy.tone === 'bad'
            ? 'border-bad/40 bg-bad/5'
            : 'border-[rgba(var(--goldA),0.3)] bg-[rgba(var(--goldA),0.05)]'
      }`}
    >
      <h2 className="text-[14px] font-bold text-text">{copy.title}</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-text2">{copy.body}</p>

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

function ContractCard({ contract }: { readonly contract: PartnerContract }) {
  return (
    <li className="grid gap-2 rounded-card border border-line bg-card px-3.5 py-3">
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
        className="inline-flex min-h-10 w-fit items-center rounded-lg border border-gold px-4 text-[12.5px] text-gold-ink transition-colors hover:bg-gold hover:text-bg lg:min-h-0 lg:py-2"
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
 * ## It renders from the first copy
 *
 * It was gated at two until Bashar overruled it (2026-08-23) — see the note inside. An empty area
 * where a record should be reads as a missing feature, not as an empty one.
 */
function ContractHistory({ contract }: { readonly contract: PartnerContract }) {
  /* Newest first, ordered by the query — the copy being acted on is the one at the top. */
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
        <p className="text-[11.5px] leading-relaxed text-gold-ink">
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
