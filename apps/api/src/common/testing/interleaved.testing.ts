import type { Database } from '@safra/db';

/**
 * The same database, with `before` run ONCE at the moment a service opens its transaction.
 *
 * ## Why a race is staged rather than raced
 *
 * `createRollbackDatabase` pins one connection, so two calls fired with `Promise.all` simply run one
 * after the other and pass whatever the code does. The defects these suites hold are all one shape:
 * a service reads a status, decides, and only then opens the transaction that writes. Another writer
 * committing in that gap is the whole bug. Running the other writer at exactly that moment puts it
 * in the gap every time, so the test fails against the unguarded code on every run rather than on
 * one in fifty.
 *
 * Shared because four suites needed it, and four copies of a Proxy are four places for one to bind
 * `this` wrongly and stage nothing.
 */
export function interleaved(db: Database, before: () => Promise<unknown>): Database {
  let fired = false;

  return new Proxy(db, {
    get(target, property, receiver): unknown {
      if (property === 'transaction') {
        return async (...args: Parameters<Database['transaction']>) => {
          if (!fired) {
            fired = true;
            await before();
          }

          return target.transaction(...args);
        };
      }

      const value: unknown = Reflect.get(target, property, receiver);

      /* Bound to the real handle, so the driver's own `this` is never the proxy. */
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}
