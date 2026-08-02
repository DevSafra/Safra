import { redirect } from 'next/navigation';

/**
 * Booking lookup.
 *
 * A GET form cannot post to a dynamic segment, so it lands here and is redirected.
 * The alternative — a client component building the URL — would need JavaScript for
 * what is genuinely a link.
 *
 * There is deliberately no list of all bookings: §9.4 is a lookup by the reference a
 * customer reads out, and a browsable index of every booking on the platform is a
 * privacy surface with no operational use.
 */
export default async function BookingLookup({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const raw = query['reference'];
  const reference = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase();

  if (!reference) redirect('/');

  redirect(`/bookings/${encodeURIComponent(reference)}`);
}
