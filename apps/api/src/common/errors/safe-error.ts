/**
 * Describing a caught error for a LOG or a stored column, without writing personal data into it.
 *
 * ## The finding this exists for (`O-sec-7`, found live 2026-08-20)
 *
 * `drizzle-orm` builds `DrizzleQueryError`'s message as
 *
 * ```
 * Failed query: <sql>
 * params: <the bound VALUES>
 * ```
 *
 * — the values, not the placeholders (`drizzle-orm/errors.js`; still true at 0.45.2, re-read
 * 2026-08-25). So ANY code that logs `error.message` from a database failure writes them out.
 * Verified against the running API rather than inferred: a failing sign-in produced
 * `params: someone@safra.test,1`, and on the paths that write a `users` row the same line carries
 * the **Argon2id hash** and the **encrypted TOTP secret**.
 *
 * `JsonLogger` cannot help. Its `REDACTED_KEYS` works on object KEYS, and this is one flat string.
 * `Error.prototype.stack` re-introduces it too, because a stack begins with `name: message`.
 *
 * ## Why this is a module and not three functions inside the filter
 *
 * `AppExceptionFilter` fixed it in ONE place on 2026-08-20 and the register said the shape "should
 * be lifted into a shared module when the sweep happens" (`O-sec-7`). This is that module. The
 * filter now imports these rather than owning them, so there is one answer to "how is a caught
 * error written down" instead of one answer and twenty-five call sites doing something else.
 *
 * **This is the standard shape** (Bashar, 2026-08-25, choosing it over a new structured format for
 * `scheduled_job_runs.error`): the error's name, its SQLSTATE where it has one, the failing SQL,
 * and a COUNT of the parameters that were withheld — walking the `cause` chain so a wrapped driver
 * error is described too.
 */

/** How far down a `cause` chain to look. `pg-pool` wraps once; nothing here wraps deeper. */
const MAX_CAUSE_DEPTH = 3;

/** Long enough to identify a statement, short enough that one error cannot flood a log. */
const MAX_LOGGED_MESSAGE = 600;

/** Every error in a `cause` chain, outermost first, bounded so a cycle cannot hang the caller. */
export function chain(error: unknown): unknown[] {
  const seen: unknown[] = [];
  let current = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current != null; depth += 1) {
    if (seen.includes(current)) break;
    seen.push(current);
    current = (current as { cause?: unknown }).cause;
  }

  return seen;
}

export function truncate(text: string): string {
  return text.length <= MAX_LOGGED_MESSAGE
    ? text
    : `${text.slice(0, MAX_LOGGED_MESSAGE)}… (${text.length} chars)`;
}

/**
 * One error's message, with the BOUND PARAMETERS removed.
 *
 * **The SQL itself is kept.** It is the useful half, it names no person, and an error line that
 * cannot say which statement failed is not worth writing. Only the values go, replaced by how many
 * there were — which is enough to tell a truncated statement from a mis-bound one.
 */
export function safeMessage(error: Error): string {
  const { query, params } = error as { query?: unknown; params?: unknown };

  if (typeof query === 'string' && Array.isArray(params)) {
    return `Failed query: ${truncate(query)} — ${params.length} bound parameter(s), NOT logged`;
  }

  return truncate(error.message);
}

/**
 * The standard description of a caught error: name, SQLSTATE, safe message, down the cause chain.
 *
 * The SQLSTATE is the single most useful thing in a database failure and is not personal data —
 * `23505` says a unique constraint was violated, `40001` says serialisation failed, `57014` says a
 * statement timed out. A description that omitted it would send whoever is on call to read the
 * query by hand.
 */
export function describeError(exception: unknown): string {
  if (!(exception instanceof Error)) return `Non-Error thrown: ${typeof exception}`;

  return chain(exception)
    .filter((link): link is Error => link instanceof Error)
    .map((link) => {
      const code = (link as { code?: unknown }).code;
      const sqlstate = typeof code === 'string' ? ` [${code}]` : '';

      return `${link.name}${sqlstate}: ${safeMessage(link)}`;
    })
    .join(' ← ');
}

/**
 * A stack with its first line removed.
 *
 * `Error.prototype.stack` begins with `name: message`, so logging the stack of a
 * `DrizzleQueryError` re-introduces exactly the bound parameters `safeMessage` just took out. The
 * frames are what a stack is FOR; the message is already on the line above it.
 */
export function framesOnly(error: Error): string | undefined {
  const stack = error.stack;

  if (!stack) return undefined;

  const firstFrame = stack.indexOf('\n    at ');

  return firstFrame === -1 ? undefined : stack.slice(firstFrame + 1);
}
