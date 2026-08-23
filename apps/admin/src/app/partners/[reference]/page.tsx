import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import { getContracts, getPartner, getSanctionsStatus } from '@/lib/api';
import { Ltr, StatusPill } from '@/components/admin-table';
import { statusTone } from '@/lib/status-tone';
import { DocumentReview } from '@/components/document-review';
import { ScreeningPanel } from '@/components/screening-panel';
import { DEFAULT_SANCTIONS_POLICY } from '@safra/contracts';

import { PartnerContractPanel } from '@/components/partner-contract-panel';
import { VerifyPartner } from '@/components/verify-partner';
import { PartnerTwoFactor } from '@/components/partner-two-factor';
import { BackLink, type BackTarget } from '@/components/back-link';
import { backTarget } from '@/lib/search-params';
import { fill, label, t } from '@/lib/strings';

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
          <Row
            label={t.sections.partnerDetail.applied}
            value={partner.createdAt?.slice(0, 10) ?? '—'}
          />
        </dl>
      </Section>

      {/* ── §8.1 documents, reviewed one at a time (item 121) ─────────────── */}
      <Section title={t.sections.partnerDetail.documents}>
        {partner.documents.length === 0 ? (
          <p className="rounded-lg border border-gold/30 bg-gold/5 p-3 text-sm text-gold">
            {t.sections.partnerDetail.noDocuments}
          </p>
        ) : (
          <ul className="grid gap-2">
            {partner.documents.map((document) => (
              <li key={document.id}>
                <DocumentReview document={document} />
              </li>
            ))}
          </ul>
        )}
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
