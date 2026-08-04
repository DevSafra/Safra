/**
 * Stands in for Next.js's `server-only` package under Vitest.
 *
 * `server-only` has no runtime behaviour: it exists so that importing a server module from a
 * client component fails the BUILD, loudly, at the point where the mistake was made. It is
 * resolved by Next's bundler and is not a package on disk, so a plain Node test runner cannot
 * import it and every test that touches `apps/admin/src/lib/api.ts` dies on module load.
 *
 * Stubbing it does not weaken the guard. The guard is enforced by `next build`, which still
 * runs against the real resolver in `pnpm build`; this file only lets the same source be
 * imported by a test process that has no bundler at all.
 */
export {};
