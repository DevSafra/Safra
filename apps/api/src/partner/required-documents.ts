import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';

/**
 * §8.1's verification documents, as ONE rule two services share.
 *
 * ## What the SRS actually requires
 *
 * «هوية **أو** سجل تجاري، وإثبات ملكية **أو** عقد إدارة» — one document from each pair, not both,
 * and `bank_confirmation` is not named as a verification document at all. `PARTNER_DOCUMENT_KINDS`
 * lists five kinds because five kinds exist; that list is what may be uploaded, never what must be.
 *
 * ## Why it lives here rather than in either caller
 *
 * Two places ask this question and they must answer it identically: `ReviewService` refuses to
 * ACTIVATE a partner without them (§8.1's «قبل تفعيل الحساب»), and `PartnerDocumentsService` tells
 * staff when a partner has FINISHED. Written twice they drift, and the direction they drift in is
 * one screen saying a partner is done while the other refuses to switch them on — which is exactly
 * what was happening: the completion notice demanded all five kinds, so a partner could satisfy
 * §8.1 and never be told they had.
 *
 * ## Not rejected, rather than approved
 *
 * §8.1's word is «رفع» — uploaded. A rejected document is not on file; one awaiting review is.
 * Requiring `approved` would be a stricter rule than the SRS states, and the document review has
 * its own screen and its own decision.
 */
export const REQUIRED_DOCUMENT_PAIRS = [
  ['identity', 'commercial_register'],
  ['ownership_proof', 'management_contract'],
] as const;

/** True when the partner has one settled document from each pair §8.1 names. */
export async function hasRequiredDocuments(
  db: Database,
  partnerId: string,
): Promise<boolean> {
  const rows = await db.execute<{ satisfied: boolean }>(sql`
    SELECT ${pairsSatisfied(sql`${partnerId}`)} AS satisfied
  `);

  return rows.rows[0]?.satisfied === true;
}

/**
 * The predicate as a fragment, so a caller can fold it into a larger statement.
 *
 * `EXISTS` per pair rather than a count over distinct kinds: the question is "is there one of
 * these", and a count would change meaning the moment a sixth kind is added to the enum.
 */
export function pairsSatisfied(partnerId: SQL): SQL {
  const [identity, rightToLet] = REQUIRED_DOCUMENT_PAIRS;

  return sql`(${exists(partnerId, identity)} AND ${exists(partnerId, rightToLet)})`;
}

function exists(partnerId: SQL, kinds: readonly string[]): SQL {
  return sql`EXISTS (
    SELECT 1 FROM partner_documents d
    WHERE d.partner_id = ${partnerId}
      AND d.kind IN (${sql.join(
        kinds.map((kind) => sql`${kind}`),
        sql`, `,
      )})
      AND d.status <> 'rejected'
      AND d.deleted_at IS NULL
  )`;
}
