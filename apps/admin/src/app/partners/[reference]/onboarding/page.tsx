import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import {
  canFileJointContract,
  DEFAULT_SANCTIONS_POLICY,
  missingOnboardingDocuments,
} from '@safra/contracts';

import { getContracts, getPartner, getSanctionsStatus } from '@/lib/api';
import { Ltr, StatusPill } from '@/components/admin-table';
import { statusTone } from '@/lib/status-tone';
import { DocumentReview } from '@/components/document-review';
import { PartnerContractPanel } from '@/components/partner-contract-panel';
import { PartnerAccountState } from '@/components/partner-account-state';
import { PartnerDocumentUpload } from '@/components/partner-document-upload';
import { ScreeningPanel } from '@/components/screening-panel';
import { VerifyPartner } from '@/components/verify-partner';
import { BackLink } from '@/components/back-link';
import { backTarget } from '@/lib/search-params';
import { fill, label, t } from '@/lib/strings';
import { count } from '@/lib/format';
import { refuseSection } from '@/components/section-refusal';

/**
 * تسجيل شريك جديد, steps 2 to 5 — the rest of the sitting (Bashar, 2026-08-23).
 *
 * ## Why a screen of its own rather than the partner detail page
 *
 * Because a checklist and a record are different things. `/partners/[reference]` answers "what do
 * we know about this partner", laid out in the order a REVIEWER makes a decision. This answers
 * "what is still outstanding before they can trade", in the order the steps have to HAPPEN — and
 * that order is load-bearing for the contract: generate, SAFRA signs, partner signs, approve.
 * Re-uploading SAFRA's copy after the partner has signed supersedes their signature, so a screen
 * that presented those as four equal panels would invite exactly that mistake.
 *
 * The panels themselves are the same components the detail screen uses. Nothing about documents,
 * contracts, screening or approval is reimplemented here: this composes them, numbers them, and
 * says which are done.
 *
 * ## It is not a wizard that gates
 *
 * Every step is reachable at any time and none blocks the next. Two reasons. The API is the
 * boundary — `PARTNER_APPROVE` decides approval, not this layout — and a partner whose commercial
 * register is with their accountant is a conversation rather than a locked screen. The
 * sanctions feed already taught this codebase what happens when onboarding is made to depend on a
 * control that can be unavailable.
 *
 * ## Reachable for any partner, not only a fresh one
 *
 * There is no "was this partner onboarded in person" check, deliberately. A partner who applied
 * through «انضم كشريك» and then walked in with their documents is the same job, and a screen that
 * refused them would send the operator back to doing it in four places.
 */
export const dynamic = 'force-dynamic';

export default async function PartnerOnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
    FIRST, before any fetch.

    `staffFetch` maps a 403 to 'unauthenticated', so a guard placed after the fetches never
    runs: the page has already rendered «انتهت الجلسة» to somebody whose session is fine, and
    signing in again lands them here again.
  */
  const refused = await refuseSection('partners', t.nav.partners);

  if (refused) return refused;

  const { reference } = await params;
  const query = await searchParams;

  const [partner, listStatus, contracts] = await Promise.all([
    getPartner(reference),
    getSanctionsStatus(),
    getContracts(reference),
  ]);

  const back = backTarget('/partners', query, reference);

  if (partner === 'unauthenticated') {
    return (
      <Shell back={back}>
        <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
      </Shell>
    );
  }

  /* A missing partner and an unreadable one both render as not found — see `staffFetch`. */
  if (partner === 'failed') notFound();

  const contractRows =
    contracts === 'failed' || contracts === 'unauthenticated' ? [] : contracts.contracts;

  const policy =
    listStatus === 'failed' || listStatus === 'unauthenticated'
      ? DEFAULT_SANCTIONS_POLICY
      : listStatus.policy;

  const screened = partner.sanctionsScreenedAt !== null;
  const approved = partner.verification === 'approved';
  const decided = partner.verification !== 'pending';

  /*
    Which required documents are still missing, answered by the shared helper rather than by a
    comparison written here. Two hand-written versions of "what §8.1 wants" would drift, and the
    one that drifted would be the screen telling somebody they were finished.

    The kinds that COUNT are the ones on file at all, not the approved ones: this checklist is
    about whether the paperwork was collected. Whether each is acceptable is the review decision
    on the row itself, which is a separate control with its own permission.
  */
  const missing = missingOnboardingDocuments(partner.documents.map((doc) => doc.kind));

  /* `active` means both parties have signed — the state the approval step wants to see. */
  const contractActive = contractRows.some((contract) => contract.status === 'active');
  const contractState = contractStateOf(contractRows);

  return (
    <Shell back={back}>
      <header>
        <p className="text-xs text-faint">
          <Ltr>{partner.reference}</Ltr>
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-text">{partner.legalName}</h1>
        <p className="mt-1 text-sm text-muted">
          {t.sections.partnerOnboarding.stepsTitle}
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-2">
          <StatusPill tone={statusTone(partner.verification)}>
            {label(t.enums.verification, partner.verification)}
          </StatusPill>
          {/*
            A NEW TAB, and a plain `<a>` rather than `next/link` (Bashar, 2026-08-23).

            The onboarding checklist is a place somebody is working THROUGH — documents chosen, a
            contract generated, an approval still to make — and sending them to the partner record
            in the same tab costs them that position and a scroll back to it. The partner page is a
            reference they glance at, so it belongs beside the work rather than instead of it.

            `next/link` would prefetch a route it is not going to navigate to in this tab, and its
            client-side navigation is exactly what `target="_blank"` bypasses. `rel` is the usual
            pair: `noopener` denies the new document a handle on this one, `noreferrer` withholds
            the URL of a staff console screen — cheap here since both ends are ours, and the habit
            is what matters when a link one day is not.
          */}
          <a
            href={`/partners/${encodeURIComponent(partner.reference)}`}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={t.sections.partnerOnboarding.openPartnerAria}
            className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-ok/40 hover:text-ok lg:min-h-0"
          >
            {t.sections.partnerOnboarding.openPartner}
          </a>
        </p>
      </header>

      {/*
        Said once, at the top, and only just after the record was created.

        The reader needs to know the partner EXISTS before they read a list of outstanding steps,
        or the screen reads as a failure. It is driven off a query parameter rather than off the
        row's age, because "was this just created" is a fact about this navigation and not about
        the partner — and `router.replace` means a reload does not repeat the claim falsely.
      */}
      {query['created'] === '1' ? (
        <p className="rounded-lg border border-ok/30 bg-ok/5 px-4 py-3 text-[12.5px] leading-relaxed text-ok">
          {fill(
            query['adopted'] === '1'
              ? t.sections.partnerOnboarding.createdExistingAccount
              : t.sections.partnerOnboarding.created,
            { reference: partner.reference, email: partner.email },
          )}{' '}
          {t.sections.partnerOnboarding.mailMayLag}
        </p>
      ) : null}

      {/* ── ① The details, already done by the time this screen renders ────── */}
      <Step
        number={1}
        title={t.sections.partnerOnboarding.step1}
        state="done"
        note={fill(t.sections.partnerDetail.tradingAs, {
          name: `${partner.displayName} · ${
            partner.partnerType.nameAr ?? partner.partnerType.nameEn
          } · ${partner.city.nameAr ?? partner.city.nameEn}`,
        })}
      >
        {/*
          Whether the partner can actually sign in — the fact this screen used to omit.

          It sits under step ① because the account belongs to the record, and because it is the one
          thing here nobody in the room can finish. Everything below carries on without it; the
          partner leaves approved and signs in when they open their mail.
        */}
        <PartnerAccountState
          reference={partner.reference}
          email={partner.email}
          activated={partner.accountActivated}
          invitationPending={partner.invitationPending}
        />
      </Step>

      {/* ── ② The documents ────────────────────────────────────────────────── */}
      <Step
        number={2}
        title={t.sections.partnerOnboarding.step2}
        state={missing.length === 0 ? 'done' : 'outstanding'}
        note={
          missing.length === 0
            ? t.sections.partnerOnboarding.documentsComplete
            : fill(t.sections.partnerOnboarding.documentsRequired, {
                kinds: missing.map(documentKindLabel).join(' · '),
              })
        }
      >
        <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
          {t.sections.partnerOnboarding.documentsIntro}
        </p>

        <PartnerDocumentUpload reference={partner.reference} />

        {partner.documents.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-faint">
            {t.sections.partnerOnboarding.noDocumentsYet}
          </p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {partner.documents.map((document) => (
              <li key={document.id}>
                <DocumentReview document={document} />
              </li>
            ))}
          </ul>
        )}
      </Step>

      {/* ── ③ The contract, in the order the steps have to happen ──────────── */}
      <Step
        number={3}
        title={t.sections.partnerOnboarding.step3}
        state={contractActive ? 'done' : 'outstanding'}
        note={t.sections.partnerOnboarding[contractState]}
      >
        <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
          {t.sections.partnerOnboarding.contractIntro}
        </p>

        {/*
          The joint upload is offered ONLY while the partner is still pending
          (Bashar, 2026-08-23).

          It is the in-person control — one sheet, both signatures, binding on the spot — and it
          belongs to onboarding rather than to contract management, so the partner detail screen
          does not offer it at all. The API enforces the same rule; this decides what the screen
          shows.

          The condition is passed rather than a bare `true`, because this screen is reachable for
          ANY partner, including an approved one, and step ⑤ below can approve without leaving the
          page. Hard-coding it would leave a button on screen that the server had just started
          refusing, one click after the operator pressed «الموافقة على الشريك».

          `canFileJointContract`, not a comparison written here. This was `verification ===
          'pending'` and that was WRONG in a way that would not have shown up in any test on this
          screen: it omitted `in_review`, so the button vanished during review while the API went
          on accepting it. One predicate, called by both sides, is the only arrangement where the
          screen and the server cannot drift — and the case they must agree on hardest is
          `rejected`, which neither offers, because filing a signed agreement for a partner the
          platform turned down records an agreement with somebody we declined to trade with.
        */}
        <PartnerContractPanel
          partnerReference={partner.reference}
          contracts={contractRows}
          allowJointUpload={canFileJointContract(partner.verification)}
        />
      </Step>

      {/* ── ④ Screening. Advisory by policy, so it is marked as such ───────── */}
      {policy === 'off' ? null : (
        <Step
          number={4}
          title={t.sections.partnerOnboarding.step4}
          state={screened ? 'done' : policy === 'required' ? 'outstanding' : 'optional'}
          note={
            screened
              ? t.sections.partnerOnboarding.screeningDone
              : t.sections.partnerOnboarding.screeningPending
          }
        >
          <ScreeningPanel
            reference={partner.reference}
            screenedAt={partner.sanctionsScreenedAt}
            result={partner.sanctionsScreeningResult}
            listStatus={
              listStatus === 'failed' || listStatus === 'unauthenticated'
                ? null
                : listStatus
            }
          />
        </Step>
      )}

      {/* ── ⑤ The approval — the only irreversible thing on this screen ────── */}
      <Step
        number={5}
        title={t.sections.partnerOnboarding.step5}
        state={approved ? 'done' : 'outstanding'}
        note={
          approved
            ? t.sections.partnerOnboarding.approvalDone
            : t.sections.partnerOnboarding.approvalPending
        }
      >
        <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
          {t.sections.partnerOnboarding.approvalIntro}
        </p>

        {decided ? (
          <p className="rounded-lg border border-line bg-card p-4 text-sm text-muted">
            {partner.verifiedAt
              ? fill(t.sections.partnerDetail.alreadyDecidedOn, {
                  status: label(t.enums.verification, partner.verification),
                  date: partner.verifiedAt.slice(0, 10),
                })
              : fill(t.sections.partnerDetail.alreadyDecided, {
                  status: label(t.enums.verification, partner.verification),
                })}
          </p>
        ) : (
          <VerifyPartner
            reference={partner.reference}
            screened={screened}
            contractActive={contractActive}
            policy={policy}
          />
        )}
      </Step>
    </Shell>
  );
}

/**
 * Which sentence describes where the contract has got to.
 *
 * Read off the NEWEST non-superseded row rather than "any active row", because a partner can hold
 * a superseded base agreement and a fresh draft at once — and "وقّع الطرفان" about the superseded
 * one would be true of a document that is no longer in force.
 */
function contractStateOf(
  contracts: readonly { status: string }[],
):
  | 'contractStateNone'
  | 'contractStateDraft'
  | 'contractStateAwaitingPartner'
  | 'contractStateActive' {
  if (contracts.some((contract) => contract.status === 'active')) {
    return 'contractStateActive';
  }

  if (contracts.some((contract) => contract.status === 'awaiting_partner_signature')) {
    return 'contractStateAwaitingPartner';
  }

  if (contracts.some((contract) => contract.status === 'draft')) {
    return 'contractStateDraft';
  }

  return 'contractStateNone';
}

/**
 * The Arabic name of a required document kind.
 *
 * `right_to_let` is the pseudo-kind `missingOnboardingDocuments` returns when neither a title deed
 * nor a management contract is on file — the reader needs to know one of the two is wanted, not
 * that both are, so it has its own phrase rather than being a list of two.
 */
function documentKindLabel(kind: string): string {
  return kind === 'right_to_let'
    ? t.sections.partnerOnboarding.rightToLet
    : label(t.enums.documentKind, kind);
}

function Shell({
  back,
  children,
}: {
  back: { href: string; origin: ReturnType<typeof backTarget>['origin'] };
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <BackLink target={back} section={t.nav.partners} />
      <div className="mt-4 grid gap-6">{children}</div>
    </main>
  );
}

/**
 * One numbered step, with its state said in words as well as in colour.
 *
 * The word matters: «تم» / «مطلوب» / «اختياري» is what a colour-blind reader gets, and it is also
 * what an operator reads aloud to the partner sitting next to them. A tinted border alone would
 * make the screen unreadable over a telephone.
 */
function Step({
  number,
  title,
  state,
  note,
  children,
}: {
  number: number;
  title: string;
  state: 'done' | 'outstanding' | 'optional';
  note: string;
  children?: ReactNode;
}) {
  const tone =
    state === 'done'
      ? { border: 'border-ok/30', text: 'text-ok' }
      : state === 'optional'
        ? { border: 'border-line', text: 'text-muted' }
        : { border: 'border-gold/30', text: 'text-gold' };

  const stateWord =
    state === 'done'
      ? t.sections.partnerOnboarding.stepDone
      : state === 'optional'
        ? t.sections.partnerOnboarding.stepOptional
        : t.sections.partnerOnboarding.stepOutstanding;

  return (
    <section className={`rounded-lg border ${tone.border} bg-field/40 p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base text-text">
          {/*
            `count()`, not a literal numeral. The console prints WESTERN digits throughout
            (`ARABIC_WESTERN_DIGITS` in `format.ts`), so a hand-written «١» here would be the one
            Eastern digit on an Arabic screen full of Western ones.
          */}
          <span className="me-2 text-faint">{count(number)}</span>
          {title}
        </h2>
        <span className={`text-[11.5px] font-semibold ${tone.text}`}>{stateWord}</span>
      </div>

      <p className={`mt-1 text-[12px] ${tone.text}`}>{note}</p>

      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}
