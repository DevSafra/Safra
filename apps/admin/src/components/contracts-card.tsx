import { getContracts, type ContractItem } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { ConsolePanel } from '@/components/console-shell';
import { FootNote, Ltr, StatusPill, type Tone } from '@/components/admin-table';
import { fill, t } from '@/lib/strings';
import { statusTone } from '@/lib/status-tone';

/**
 * عقود الشراكة — the contract list and upload (design handoff §8.1).
 *
 * ## The row shows the STATUS, and the status is what an operator acts on
 *
 * The design's three examples are "ساري حتى …", "بانتظار توقيع الشريك" and "ينتهي خلال 41 يوماً".
 * All three are derived here rather than stored as prose: an expiry warning computed from the date
 * cannot go stale, and a stored string would keep saying "41 days" forever.
 *
 * ## عرض is not implemented, and says so
 *
 * The design has a view button. Serving the file needs a per-request authorization check plus a
 * short-lived signed URL — the same pattern partner documents use — and it is a separate piece of
 * work from filing the contract. A button that downloaded nothing would be worse than a disabled
 * one; a button that downloaded WITHOUT the check would be much worse than either.
 */
export async function ContractsCard({ partnerReference }: { partnerReference?: string }) {
  const result = await getContracts(partnerReference);

  return (
    <ConsolePanel title={t.sections.contracts.title}>
      <p className="mb-3 text-[11.5px] text-faint">{t.sections.contracts.hint}</p>

      {result === 'unauthenticated' ? (
        <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
      ) : result === 'failed' ? (
        <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
      ) : result.contracts.length === 0 ? (
        <p className="text-[12.5px] text-faint">{t.sections.contracts.none}</p>
      ) : (
        <ul className="grid gap-2.25">
          {result.contracts.map((contract) => (
            <li key={contract.id}>
              <ContractRow contract={contract} />
            </li>
          ))}
        </ul>
      )}

      <FootNote>{t.sections.contracts.supersedeNote}</FootNote>
    </ConsolePanel>
  );
}

function ContractRow({ contract }: { contract: ContractItem }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-line bg-field px-3.5 py-2.75">
      {/* The design's 32×32 gold PDF tile. */}
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-lg border border-[rgba(var(--goldA),0.3)] bg-[rgba(var(--goldA),0.12)] text-[10px] font-extrabold text-gold-ink"
      >
        PDF
      </span>

      <span className="min-w-0">
        <Ltr className="block truncate text-[13px] font-bold text-text">
          {contract.fileName}
        </Ltr>
        <span className="block text-[11px] text-faint">
          <Ltr>{contract.partnerReference}</Ltr> · {kindLabel(contract.kind)} ·{' '}
          {fill(t.sections.contracts.uploadedBy, {
            date: shortDate(contract.uploadedAt),
            who: contract.uploadedBy ?? t.admin.systemActor,
          })}
        </span>
      </span>

      <span className="ms-auto shrink-0">
        <StatusPill tone={contractTone(contract)}>{statusLabel(contract)}</StatusPill>
      </span>

      <span
        aria-disabled="true"
        title={t.nav.notBuilt}
        className="shrink-0 cursor-not-allowed rounded-lg border border-line px-3.5 py-1 text-[11.5px] font-bold text-faint2"
      >
        {t.sections.contracts.view}
      </span>
    </div>
  );
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'commission_annex':
      return t.sections.contracts.kindCommissionAnnex;
    case 'renewal':
      return t.sections.contracts.kindRenewal;
    default:
      return t.sections.contracts.kindBase;
  }
}

/**
 * The status line, derived so it cannot go stale.
 *
 * Expiry outranks everything: an ACTIVE contract that expired last week is not in force, and
 * showing "ساري" for it would be true of the column and false of the world.
 */
function statusLabel(contract: ContractItem): string {
  if (contract.status === 'superseded') return t.sections.contracts.superseded;
  if (contract.status === 'terminated') return t.sections.contracts.terminated;
  if (contract.status === 'awaiting_partner_signature') {
    return t.sections.contracts.awaitingSignature;
  }

  /*
    A draft is not in force, and this card said it was.

    Every branch below reads the CALENDAR — and a draft has no expiry, so it fell through to
    «ساري حتى —»: the console telling an operator that a generated, unsigned, unsent document was
    a valid contract. `draft` joined the enum on 2026-08-21 with the two-sided signing flow and
    this function was not taught it; nothing failed, because the label it produced was
    well-formed. `e2e/navigation.spec.ts` caught it as a COLOUR clash — the same phrase in two
    tones on الشركاء — which is the only reason it surfaced at all.
  */
  if (contract.status === 'draft') return t.sections.contracts.draft;

  if (contract.daysToExpiry === null)
    return fill(t.sections.contracts.validUntil, { date: '—' });
  if (contract.daysToExpiry < 0) return t.sections.contracts.expired;

  /* Inside 60 days the message becomes a countdown, which is what prompts a renewal. */
  return contract.daysToExpiry <= 60
    ? fill(t.sections.contracts.expiringIn, { days: String(contract.daysToExpiry) })
    : fill(t.sections.contracts.validUntil, { date: shortDate(contract.expiresAt) });
}

/**
 * A contract's colour, which is its STATUS unless the calendar overrules it.
 *
 * The one place in the console that does not simply call `statusTone(value)`, and the reason is
 * the same one `statusLabel` gives above: an `active` contract that expired last week is not in
 * force, and painting it green would be true of the column and false of the world. Expiry is a
 * fact the status column does not know.
 *
 * Everything else DELEGATES, so `superseded`, `terminated` and `awaiting_partner_signature` are
 * whatever they are everywhere else. The old version repeated all three inline and would have
 * drifted from the shared map the first time one of them changed.
 */
function contractTone(contract: ContractItem): Tone {
  if (contract.status === 'active' && contract.daysToExpiry !== null) {
    if (contract.daysToExpiry < 0) return 'bad';

    /* Inside 60 days it is a countdown, and a countdown is a warning, not a failure. */
    if (contract.daysToExpiry <= 60) return 'warn';
  }

  return statusTone(contract.status);
}
