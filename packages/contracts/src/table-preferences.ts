import { z } from 'zod';

/**
 * How many rows a staff member wants per page, remembered per registry.
 *
 * Every console table starts at `DEFAULT_TABLE_PAGE_SIZE` and remembers a change against the
 * ACCOUNT rather than the browser (Bashar, 2026-08-06), so the choice survives a new laptop, a
 * cleared cache and a second device. Stored in `users.table_page_sizes`.
 */

/** Ten rows, everywhere, until somebody says otherwise. */
export const DEFAULT_TABLE_PAGE_SIZE = 10;

/**
 * The registries whose page size can be remembered — an ALLOW-LIST, not a free-form key.
 *
 * This is the security boundary of the whole preference. The value lands in a `jsonb` column, so
 * without it a caller could write arbitrary keys and arbitrary depth into a row on the `users`
 * table — a column that is read on every authenticated request. Fourteen literals means the worst
 * a crafted request can do is set a number this person could have set from the UI anyway.
 *
 * Each entry is also a console route, which is what lets the save endpoint redirect back to the
 * list from a LITERAL path rather than one supplied by the caller.
 */
export const TABLE_SECTIONS = [
  'bookings',
  'partners',
  'properties',
  'customers',
  'staff',
  'payments',
  'wallet',
  'giftcards',
  'coupons',
  'ads',
  'disputes',
  'messages',
  'comms',
  'audit',
  /* Partner transfers — a registry under الدفع والفواتير rather than a 20th sidebar section. */
  'payouts',
  /* The reported-review moderation queue, beside النزاعات. */
  'reviews',
  /* Requested CSV exports, collected from a screen under الحجوزات rather than a sidebar section. */
  'exports',
  /**
   * The staff SCOPE map, which is a second paged list on the same screen as the staff registry.
   *
   * It needs its own key or the two would overwrite each other's size, and its own entry in the
   * maps below because the screen it lives on is `/staff` and its URL parameters are namespaced.
   * That is the whole reason a section is not simply "the path": one route, two tables.
   */
  'staffScope',
  /* «طلبات الشراكة» — the join-request queue, its own sidebar section (Bashar, 2026-08-19). */
  'partnerApplications',
  /**
   * The two P-002 VERIFICATION QUEUES, each a second paged list on its section's screen.
   *
   * They were not paged at all until 2026-08-20: the service took `limit = 50` and the screen
   * rendered whatever came back. With 527 partners awaiting verification that meant 477 of them were
   * unreachable through the console — and nothing said so, so the queue looked fifty deep. The
   * sidebar badge counted the real figure beside a list that could not show it.
   *
   * Own keys for the same reason as `staffScope`: they share a route with a registry that already
   * owns `?page=`, so their parameters are namespaced and their rows-per-page must not overwrite it.
   */
  'partnersPending',
  'propertiesPending',
  /**
   * آخر نشاط الموظفين — a second paged list on `/staff`, beneath the registry.
   *
   * Its own key and namespaced parameters for the same reason as `staffScope`: it shares a route
   * with a registry that already owns `?page=`, and sharing them would drag the reader's place in
   * the accounts list along every time they stepped through the activity.
   *
   * `staffScope` above is now unused — نطاق العمل moved onto the member's own record on 2026-08-23
   * — and is deliberately NOT removed. It is a KEY that may already exist in `users.table_page_sizes`
   * for real accounts, so dropping it from the allow-list would turn somebody's stored preference
   * into a value this schema rejects.
   */
  'staffActivity',
] as const;

export type TableSection = (typeof TABLE_SECTIONS)[number];

/**
 * Where each section lives, as a LITERAL path.
 *
 * The save endpoint redirects here after writing. Nothing in a request supplies a path — it picks
 * a key, and this map turns the key into a route — because an endpoint that redirects to a
 * caller-supplied target is the classic open redirect.
 */
export const TABLE_SECTION_PATHS: Readonly<Record<TableSection, string>> = {
  bookings: '/bookings',
  partners: '/partners',
  properties: '/properties',
  customers: '/customers',
  staff: '/staff',
  payments: '/payments',
  wallet: '/wallet',
  giftcards: '/giftcards',
  coupons: '/coupons',
  ads: '/ads',
  disputes: '/disputes',
  messages: '/messages',
  comms: '/comms',
  audit: '/audit',
  payouts: '/payouts',
  reviews: '/reviews',
  exports: '/bookings/exports',
  staffScope: '/staff',
  staffActivity: '/staff',
  partnerApplications: '/applications',
  partnersPending: '/partners',
  propertiesPending: '/properties',
};

/**
 * The URL parameter names each section pages with.
 *
 * Three routes carry TWO tables — `/staff`, `/partners` and `/properties` — so the second one on
 * each namespaces its parameters. Sharing `?page=` would move both at once, which is not a
 * cosmetic problem: the reader would page the registry and watch the queue jump.
 *
 * Derived from the section on the SERVER rather than sent with the request, so a form cannot ask
 * the redirect to write a parameter of its choosing.
 */
const NAMESPACED: Readonly<
  Partial<Record<TableSection, { page: string; size: string }>>
> = {
  staffScope: { page: 'scopePage', size: 'scopeSize' },
  staffActivity: { page: 'activityPage', size: 'activitySize' },
  partnersPending: { page: 'queuePage', size: 'queueSize' },
  propertiesPending: { page: 'queuePage', size: 'queueSize' },
};

export const TABLE_SECTION_PARAMS: Readonly<
  Record<TableSection, { page: string; size: string }>
> = Object.fromEntries(
  TABLE_SECTIONS.map((section) => [
    section,
    NAMESPACED[section] ?? { page: 'page', size: 'size' },
  ]),
) as Readonly<Record<TableSection, { page: string; size: string }>>;

/**
 * A saved size, bounded by the same floor and ceiling the list endpoints enforce.
 *
 * `.strict()`, like every other contract here: an unknown field is rejected rather than ignored,
 * so a request that means something the server does not understand fails loudly.
 */
export const tablePageSizeSchema = z
  .object({
    section: z.enum(TABLE_SECTIONS),
    size: z.coerce.number().int().min(1).max(100),
  })
  .strict();

export type TablePageSizeInput = z.infer<typeof tablePageSizeSchema>;

/**
 * Reads a stored map into a size for one section, ignoring anything unusable.
 *
 * Shared by the API and the console so "what does a stored preference mean" is answered once. The
 * map comes out of `jsonb`, which has no schema at rest — a row written before the allow-list
 * existed, or by a migration, can hold anything at all. Everything that is not an in-range integer
 * for a known section falls back to the default rather than reaching a `LIMIT`.
 */
export function storedPageSize(stored: unknown, section: TableSection): number {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return DEFAULT_TABLE_PAGE_SIZE;
  }

  const value = (stored as Record<string, unknown>)[section];

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return DEFAULT_TABLE_PAGE_SIZE;
  }

  return value >= 1 && value <= 100 ? value : DEFAULT_TABLE_PAGE_SIZE;
}
