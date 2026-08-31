import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import { getContracts, getPartner, getSanctionsStatus } from '@/lib/api';
import { Ltr, StatusPill } from '@/components/admin-table';
import { statusTone } from '@/lib/status-tone';
import { ScreeningPanel } from '@/components/screening-panel';
import { DEFAULT_SANCTIONS_POLICY } from '@safra/contracts';

import { PartnerContractPanel } from '@/components/partner-contract-panel';
import { VerifyPartner } from '@/components/verify-partner';
import { PartnerCommission } from '@/components/partner-commission';
import { PartnerTwoFactor } from '@/components/partner-two-factor';
import { PartnerSuspension } from '@/components/partner-suspension';
import { BackLink, type BackTarget } from '@/components/back-link';
import { backTarget } from '@/lib/search-params';
import { fill, label, t } from '@/lib/strings';
import { refuseSection } from '@/components/section-refusal';

/**
 * One partner's application, and the decision (SRS §8.1).
 *
 * The screen the whole onboarding loop has been waiting for: partners could apply
 * (item 83) and upload documents (item 82), and no human could look at either
 * without curl.
 *
 * Laid out in the order the decision is actually made — who they are, what they sent,
 * whether they are sanctioned, then approve or reject — rather than grouped by data
 * model. The approval control sits last because it is the only irreversible thing
 * here, and it is the one that publishes their listings (item 116).
 */
export const dynamic = 'force-dynamic';

export default async function PartnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  /* The list position to return to — see the note in the bookings detail screen. */
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
  const back = backTarget('/partners', query, reference);

  /**
   * The list's health is fetched alongside the partner, so the screening panel can
   * explain a refusal before the reviewer triggers it rather than after.
   */
  const [partner, listStatus, contracts] = await Promise.all([
    getPartner(reference),
    getSanctionsStatus(),
    getContracts(reference),
  ]);

  if (partner === 'unauthenticated') {
    return (
      <Shell reference={reference} back={back}>
        <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
      </Shell>
    );
  }

  // A missing partner and an unreadable one both render as not found — see the note
  // in `staffFetch` about not explaining which permission is absent.
  if (partner === 'failed') notFound();

  const screened = partner.sanctionsScreenedAt !== null;
  const decided = partner.verification !== 'pending';

  return (
    <Shell reference={reference} back={back}>
      <header>
        <p className="text-xs text-faint">{partner.reference}</p>
        <h1 className="mt-1 text-2xl font-semibold text-text">{partner.legalName}</h1>
        {/*
          «مراسلة» — writing to this host.

          A link rather than a form: it carries the recipient into الرسائل's composer, which is the
          one place a conversation is started. A second composer here would be a parallel messaging
          surface, which is why إرسال بدائل is a link too.
        */}
        <p className="mt-2">
          <Link
            href={`/messages?to=partner&ref=${encodeURIComponent(partner.reference)}`}
            className="inline-flex min-h-10 items-center rounded-lg border border-line px-3.5 py-1.5 text-[11.5px] font-bold text-muted transition-colors hover:border-[rgba(var(--goldA),0.45)] hover:text-gold lg:min-h-0"
          >
            {t.sections.messages.messageAction}
          </Link>
        </p>
        <p className="mt-1 text-sm text-muted">
          {fill(t.sections.partnerDetail.tradingAs, {
            name: `${partner.displayName} · ${partner.partnerType.nameAr ?? partner.partnerType.nameEn} · ${
              partner.city.nameAr ?? partner.city.nameEn
            }`,
          })}
        </p>
        {/*
          The registry's pill and the registry's colour. This screen used to build its own, which
          printed the raw enum («approved») and painted anything it did not recognise GOLD — so a
          partner awaiting verification looked like good news (Bashar, 2026-08-06).
        */}
        <p className="mt-3">
          <StatusPill tone={statusTone(partner.verification)}>
            {label(t.enums.verification, partner.verification)}
          </StatusPill>
        </p>

        {/*
          «متابعة المستندات» — carrying on an unfinished onboarding, from the record (Bashar,
          2026-08-24).

          > *"I should have an option to continue the documents of a partner with status بانتظار
          > التحقق. When I want to continue it myself I should get the onboarding screen when not
          > then display the current screen."*

          ## Why an OPTION rather than a redirect

          Because the two screens answer different questions and both are legitimate destinations
          for an undecided partner. The record answers "what do we know about them", in the order a
          REVIEWER decides; `/onboarding` answers "what is still outstanding", in the order the
          steps have to happen. Redirecting an unverified partner to the checklist would take the
          record away from somebody who came to read it — so the record stays, and the way onward
          is offered.

          ## Why only while the decision is open

          `decided` is `verification !== 'pending'`. Once a partner is approved or rejected there is
          nothing to continue, and a control that leads to a finished checklist is a control that
          teaches people to ignore it. The screen itself refuses regardless; this is about not
          offering a door that opens onto nothing.

          Styled as the primary action here, unlike the violations link below, because for a partner
          in this state it usually IS the next thing somebody does.
        */}
        {decided ? null : (
          <p className="mt-3">
            <a
              href={`/partners/${partner.reference}/onboarding`}
              className="inline-flex min-h-10 cursor-pointer items-center rounded-[9px] border border-gold/40 bg-gold/10 px-4 py-2 text-[12.5px] text-gold transition-colors hover:border-gold hover:bg-gold/15 lg:min-h-0"
            >
              {t.sections.partnerDetail.continueOnboarding}
            </a>
          </p>
        )}
      </header>

      {/* ── Contact and identity ──────────────────────────────────────────── */}
      <Section title={t.sections.partnerDetail.applicant}>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {/*
            Email and phone are Latin runs on an Arabic line. The phone is the one that broke:
            `+` is bidi-neutral, so a leading `+` is pushed to the far end and `+963900000001`
            rendered as `963900000001+` (Bashar, 2026-08-06).
          */}
          <Row
            label={t.sections.partnerDetail.email}
            value={<Ltr>{partner.email}</Ltr>}
          />
          <Row
            label={t.sections.partnerDetail.phone}
            value={<Ltr>{partner.phone}</Ltr>}
          />
          <Row label={t.sections.partnerDetail.address} value={partner.address} />
          {/*
            §8.1's «الموقع على الخريطة».

            A LINK, not an embedded map: a verifier opens it once, and an iframe would put a
            third-party script on a staff screen for a field that is checked at approval and never
            again. Coordinates that were never captured say so — «لم يُحدَّد» is a fact a verifier
            has to act on, and a blank row reads as a rendering fault.
          */}
          <Row
            label={t.sections.partnerDetail.mapLocation}
            value={
              partner.latitude && partner.longitude ? (
                <a
                  href={`https://www.openstreetmap.org/?mlat=${encodeURIComponent(partner.latitude)}&mlon=${encodeURIComponent(partner.longitude)}#map=17/${encodeURIComponent(partner.latitude)}/${encodeURIComponent(partner.longitude)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-10 items-center text-gold hover:underline lg:min-h-0"
                >
                  <Ltr>{`${partner.latitude}, ${partner.longitude}`}</Ltr>
                </a>
              ) : (
                <span className="text-faint">
                  {t.sections.partnerDetail.noMapLocation}
                </span>
              )
            }
          />
          <Row
            label={t.sections.partnerDetail.applied}
            value={partner.createdAt?.slice(0, 10) ?? '—'}
          />
          {/*
            §8.1's «بيانات التحويل المالي» — on file, or not.

            Masked at the API: the holder, the bank and the last four. A verifier is answering "can
            this business be paid, and does the account look like theirs", and the full number would
            be a credential on a screen every reader of الشركاء can open.
          */}
          <Row
            label={t.sections.partnerDetail.payoutDetails}
            value={
              partner.payoutAccounts.length === 0 ? (
                <span className="text-faint">
                  {t.sections.partnerDetail.noPayoutDetails}
                </span>
              ) : (
                <ul className="grid gap-1">
                  {partner.payoutAccounts.map((acc) => (
                    <li key={`${acc.method}-${acc.last4}`}>
                      {acc.accountHolder}
                      {acc.bankName ? ` · ${acc.bankName}` : ''} ·{' '}
                      <Ltr>{`••••${acc.last4}`}</Ltr>
                    </li>
                  ))}
                </ul>
              )
            }
          />
        </dl>
      </Section>

      {/* ── The contract (Bashar, 2026-08-21) ─────────────────────────────── */}
      <Section title={t.sections.partnerContract.title}>
        <PartnerContractPanel
          partnerReference={partner.reference}
          /*
            An empty list on a failed read, not a hidden panel. The panel's own copy explains what
            to do next, and hiding it would make a transient API failure look like a partner who
            is not yet at the contract stage.
          */
          contracts={
            contracts === 'failed' || contracts === 'unauthenticated'
              ? []
              : contracts.contracts
          }
        />
      </Section>

      {/* ── Sanctions screening (ADR 0002) ────────────────────────────────── */}
      {/*
        The negotiated commission (Bashar, 2026-08-31). Beside the contract rather than in
        الإعدادات: `commission.partner_rate` is the PLATFORM's rate and belongs there; what one
        partner agreed is a fact about that partner and belongs on their record.
      */}
      <Section title={t.sections.partnerDetail.commissionTitle}>
        <PartnerCommission
          reference={partner.reference}
          rate={partner.commissionRate}
          capUsd={partner.commissionCapUsd}
        />
      </Section>

      <Section title={t.sections.partnerDetail.sanctionsScreening}>
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
      </Section>

      {/* ── What approving will publish (item 116) ────────────────────────── */}
      <Section title={t.sections.partnerDetail.theirListings}>
        {partner.properties.length === 0 ? (
          <p className="text-sm text-faint">{t.sections.partnerDetail.noListings}</p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {partner.properties.map((property) => (
              <li
                key={property.reference}
                className="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-4 py-3"
              >
                <span className="text-text">{property.nameEn ?? property.nameAr}</span>
                <span className="text-xs text-faint">
                  <Ltr>{property.reference}</Ltr> ·{' '}
                  {label(t.enums.propertyStatus, property.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── The decision ──────────────────────────────────────────────────── */}
      <Section title={t.sections.partnerDetail.decision}>
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
            contractActive={
              contracts !== 'failed' &&
              contracts !== 'unauthenticated' &&
              contracts.contracts.some((contract) => contract.status === 'active')
            }
            /* Falls back to the contract default when the status read failed — same direction
               as the API, so a blip cannot make the screen stricter than the server. */
            policy={
              listStatus === 'failed' || listStatus === 'unauthenticated'
                ? DEFAULT_SANCTIONS_POLICY
                : listStatus.policy
            }
          />
        )}
      </Section>

      {/* ── الإيقاف والمخالفات (Bashar, 2026-08-24) ───────────────────────── */}
      <Section title={t.sections.enforcement.suspend}>
        {/*
          The banner renders here whether or not the partner is suspended — when they are, it is the
          first thing worth reading on this record, because somebody opening a suspended partner is
          usually deciding whether to lift it.
        */}
        <PartnerSuspension
          reference={partner.reference}
          suspension={partner.suspension ?? null}
        />

        {/*
          The violations LIST is its own paged screen, not a panel here.

          A partner with forty violations after two years is ordinary, and an unpaged list on a
          record is the failure «Tables and pagination» exists to prevent. This is the link to it.
        */}
        <a
          href={`/partners/${partner.reference}/violations`}
          className="mt-3 inline-flex min-h-10 cursor-pointer items-center rounded-[9px] border border-line px-4 py-2 text-[12.5px] text-muted hover:border-gold/50 hover:text-gold lg:min-h-0"
        >
          {t.sections.enforcement.openViolations}
        </a>
      </Section>

      {/* ── Their sign-in security (O-partner-4) ──────────────────────────── */}
      <Section title={t.sections.partnerTwoFactor.title}>
        <PartnerTwoFactor
          reference={partner.reference}
          enrolled={partner.twoFactorEnabled}
        />
      </Section>
    </Shell>
  );
}

function Shell({
  reference,
  back,
  children,
}: {
  reference: string;
  back: BackTarget;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <BackLink target={back} section={t.nav.partners} />
      <div className="mt-4 grid gap-8" data-partner={reference}>
        {children}
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-lg text-text">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-card px-4 py-3">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-text">{value}</dd>
    </div>
  );
}
