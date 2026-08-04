import { getContracts, type ContractItem } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { ConsolePanel } from '@/components/console-shell';
import { FootNote, Ltr, StatusPill, type Tone } from '@/components/admin-table';
import { AR } from '@/lib/strings';

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
    <ConsolePanel title={AR.sections.contracts.title}>
      <p className="mb-3 text-[11.5px] text-faint">{AR.sections.contracts.hint}</p>

      {result === 'unauthenticated' ? (
        <p className="text-[12.5px] text-muted">{AR.dashboard.sessionExpired}</p>
      ) : result === 'failed' ? (
        <p className="text-[12.5px] text-bad">{AR.dashboard.queueFailed}</p>
      ) : result.contracts.length === 0 ? (
        <p className="text-[12.5px] text-faint">{AR.sections.contracts.none}</p>
      ) : (
        <ul className="grid gap-2.25">
          {result.contracts.map((contract) => (
            <li key={contract.id}>
              <ContractRow contract={contract} />
            </li>
          ))}
        </ul>
      )}

      <FootNote>{AR.sections.contracts.supersedeNote}</FootNote>
    </ConsolePanel>
  );
}

function ContractRow({ contract }: { contract: ContractItem }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-line bg-field px-3.5 py-2.75">
      {/* The design's 32×32 gold PDF tile. */}
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-lg border border-[rgba(var(--goldA),0.3)] bg-[rgba(var(--goldA),0.12)] text-[10px] font-extrabold text-gold"
      >
        PDF
      </span>

      <span className="min-w-0">
        <Ltr className="block truncate text-[13px] font-bold text-text">
          {contract.fileName}
        </Ltr>
        <span className="block text-[11px] text-faint">
          <Ltr>{contract.partnerReference}</Ltr> · {kindLabel(contract.kind)} ·{' '}
          {AR.sections.contracts.uploadedBy(
            shortDate(contract.uploadedAt),
            contract.uploadedBy ?? AR.admin.systemActor,
          )}
        </span>
      </span>

      <span className="ms-auto shrink-0">
        <StatusPill tone={statusTone(contract)}>{statusLabel(contract)}</StatusPill>
      </span>

      <span
        aria-disabled="true"
        title={AR.nav.notBuilt}
        className="shrink-0 cursor-not-allowed rounded-lg border border-line px-3.5 py-1 text-[11.5px] font-bold text-faint2"
      >
        {AR.sections.contracts.view}
      </span>
    </div>
  );
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'commission_annex':
      return AR.sections.contracts.kindCommissionAnnex;
    case 'renewal':
      return AR.sections.contracts.kindRenewal;
    default:
      return AR.sections.contracts.kindBase;
  }
}

/**
 * The status line, derived so it cannot go stale.
 *
 * Expiry outranks everything: an ACTIVE contract that expired last week is not in force, and
 * showing "ساري" for it would be true of the column and false of the world.
 */
function statusLabel(contract: ContractItem): string {
  if (contract.status === 'superseded') return AR.sections.contracts.superseded;
  if (contract.status === 'terminated') return AR.sections.contracts.terminated;
  if (contract.status === 'awaiting_partner_signature') {
    return AR.sections.contracts.awaitingSignature;
  }

  if (contract.daysToExpiry === null) return AR.sections.contracts.validUntil('—');
  if (contract.daysToExpiry < 0) return AR.sections.contracts.expired;

  /* Inside 60 days the message becomes a countdown, which is what prompts a renewal. */
  return contract.daysToExpiry <= 60
    ? AR.sections.contracts.expiringIn(String(contract.daysToExpiry))
    : AR.sections.contracts.validUntil(shortDate(contract.expiresAt));
}

function statusTone(contract: ContractItem): Tone {
  if (contract.status === 'superseded' || contract.status === 'terminated')
    return 'faint';
  if (contract.status === 'awaiting_partner_signature') return 'warn';
  if (contract.daysToExpiry !== null && contract.daysToExpiry < 0) return 'bad';
  if (contract.daysToExpiry !== null && contract.daysToExpiry <= 60) return 'bad';

  return 'ok';
}
