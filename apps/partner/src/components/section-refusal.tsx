import { t } from '@/lib/strings';
import type { SectionAccess } from '@/lib/gate';

/**
 * What a page renders INSTEAD of itself when the reader's role does not open it.
 *
 * ## One component so nine screens cannot drift
 *
 * Each gated page needs the same branch, and nine copies of a two-line conditional is how one of
 * them ends up saying «انتهت الجلسة» a month from now — which is the exact failure this replaces.
 * The page decides WHETHER to refuse; this decides how a refusal reads.
 *
 * ## Two sentences, chosen by whether asking would help
 *
 * `owner` — no role can ever carry the capability, so the sentence closes the subject.
 * `role` — an employee could hold it and does not, so the sentence names the person who can change
 * that. Telling somebody a thing is impossible when it is merely not granted sends them away from
 * the one conversation that would fix it.
 *
 * Deliberately plain: no heading, no icon, no «عذراً». A refusal that apologises reads as a fault
 * in the product, and this is not a fault — it is the portal describing the role accurately.
 */
export function SectionRefusal({ access }: { access: Exclude<SectionAccess, 'open'> }) {
  return (
    <p className="text-sm leading-relaxed text-muted">
      {access === 'owner' ? t.employees.ownerOnly : t.employees.notInYourRole}
    </p>
  );
}
