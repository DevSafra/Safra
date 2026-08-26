import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  /** Correlates every log line, and every downstream call, for one request. */
  readonly requestId: string;
  /** Present once the request is authenticated. Never the email — see the note. */
  userId?: string | undefined;
  /**
   * Where the request came from — §15's «تسجيل IP والجهاز … في العمليات الحساسة».
   *
   * Here for the same reason the correlation ID is: an audit row is written four calls deep in a
   * service that has no idea it is in a request, and the alternative is a parameter on every
   * administrative method in forty-one files. Measured on 2026-08-26, threading it by hand had
   * reached two of them.
   *
   * `AuditService` reads these when a caller passes nothing explicitly. A scheduled job runs
   * outside any request and correctly records neither.
   *
   * Unlike `userId`, an IP address IS personal data, and it is stored on `audit_log` rather than
   * shipped to log aggregation — which is what §15 asks for and what rule 1 permits: the audit
   * trail is the one record that is allowed to say who did what from where.
   */
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * The current request, available anywhere without threading it through signatures.
 *
 * `AsyncLocalStorage` rather than a parameter on every method: a correlation ID is
 * only useful if it reaches EVERY log line, including ones written four calls deep in
 * a service that has no idea it is in a request. Threading it manually guarantees the
 * lines that matter most during an incident — the unexpected ones — are the ones
 * missing it.
 *
 * The stored context deliberately holds a user ID and not an email. Log aggregation
 * ships these off the machine, and rule 1 is explicit that full PII does not go into
 * logs; an opaque ID answers "was this all one person?" without being personal data
 * in the aggregator.
 */
const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Attaches the authenticated user to the context that is already running.
 *
 * Mutates rather than re-entering: authentication happens in a guard, well after the
 * middleware established the context, and starting a new one there would leave the
 * rest of the request outside it.
 */
export function setRequestUser(userId: string): void {
  const context = storage.getStore();

  if (context) context.userId = userId;
}
