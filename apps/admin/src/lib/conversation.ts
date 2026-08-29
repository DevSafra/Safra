import { fill, t } from '@/lib/strings';

/**
 * What a conversation IS, in words — written once because two screens read it.
 *
 * ## Why the party line is not one template
 *
 * الرسائل rendered «{customer} ↔ سفرة ↔ {partner}» for every row, and only a BOOKING thread has
 * three parties. A host's own ticket came out «فندق قصر الشرق ↔ سفرة ↔ فندق قصر الشرق» — the same
 * name on both sides — and a customer's came out «ليلى الحمصي ↔ سفرة ↔ —», an em dash standing in
 * for somebody who is not in the conversation and never was. Bashar read that screen on 2026-08-29
 * and said he was confused; this is the half of the answer that is about words.
 *
 * A dispute thread has two parties for a reason of its own: the CHECK forbids `dispute_id` beside
 * `partner_id`, so the host is structurally not in it.
 */
export function partyLine(
  kind: string,
  customer: string | null,
  partner: string | null,
): string {
  const c = t.sections.messages;
  const unknown = c.unknownParty;

  if (kind === 'booking') {
    return fill(c.parties, {
      customer: customer ?? unknown,
      partner: partner ?? unknown,
    });
  }

  /* A partner's own thread names the host; everything else names the customer. */
  const who = kind === 'partner' ? (partner ?? customer) : (customer ?? partner);

  return fill(c.partiesWith, { name: who ?? unknown });
}

/** «حجز» / «نزاع» / «شريك» / «دعم» — the four shapes a thread can have. */
export function conversationKind(kind: string): string {
  const c = t.sections.messages;

  switch (kind) {
    case 'booking':
      return c.kindBooking;
    case 'dispute':
      return c.kindDispute;
    case 'partner':
      return c.kindPartner;
    default:
      return c.kindSupport;
  }
}

/** Where the subject lives, so a reader can open the thing the thread is about. */
export function subjectHref(kind: string, reference: string | null): string | null {
  if (!reference) return null;

  if (kind === 'booking') return `/bookings/${reference}?from=messages`;
  if (kind === 'dispute') return `/disputes?q=${encodeURIComponent(reference)}`;

  return null;
}
