import type { LoggerService } from '@nestjs/common';

import { currentRequestContext } from './request-context.js';

/** Ordered least to most verbose; a configured level enables everything above it. */
const SEVERITY = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

export type ConfiguredLevel = (typeof SEVERITY)[number];

/**
 * Keys whose values are never written, at any level.
 *
 * Redaction is a property of the logger rather than a discipline expected of every
 * call site. Rule 1 forbids logging secrets, tokens, passwords or full PII, and a
 * rule that depends on every future author remembering it is not a control — the one
 * time somebody logs an object that happens to contain `password` is the time it
 * matters.
 */
const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'secret',
  'totpsecret',
  'totp_secret',
  'totpsecretencrypted',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'cardnumber',
  'card_number',
  'cvv',
  'iban',
]);

const MAX_DEPTH = 4;

/**
 * Structured JSON logs, one object per line (S-1 prerequisite).
 *
 * ## Why this exists
 *
 * Every log aggregator — Loki, CloudWatch, Datadog, anything — indexes fields, not
 * prose. Nest's default pretty printer produces lines that can only be grepped, which
 * means the first real incident is investigated with `grep` over a terminal instead
 * of a query. `LOG_LEVEL` was also declared in the environment schema and read by
 * nothing, so the setting appeared to work and did not.
 *
 * Development keeps the readable format. A developer reading JSON in a terminal is a
 * worse experience with no compensating benefit, since nothing is aggregating it.
 *
 * ## Why hand-rolled rather than pino
 *
 * Pino is the obvious dependency and would be a defensible choice. This is about
 * sixty lines because the `LoggerService` interface is five methods, and writing it
 * here buys two things that matter more than the saved lines: no new dependency in a
 * process that handles payments, and redaction that cannot be bypassed by a call site.
 * If log volume ever makes serialisation a measurable cost, swapping the `write`
 * method for pino is a contained change — that is recorded in the future-work
 * register rather than pre-emptively optimised for.
 */
export class JsonLogger implements LoggerService {
  private readonly threshold: number;

  constructor(
    level: ConfiguredLevel,
    private readonly pretty: boolean,
  ) {
    this.threshold = SEVERITY.indexOf(level);
  }

  log(message: unknown, ...rest: unknown[]): void {
    this.write('info', message, rest);
  }

  error(message: unknown, ...rest: unknown[]): void {
    this.write('error', message, rest);
  }

  warn(message: unknown, ...rest: unknown[]): void {
    this.write('warn', message, rest);
  }

  debug(message: unknown, ...rest: unknown[]): void {
    this.write('debug', message, rest);
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    this.write('trace', message, rest);
  }

  fatal(message: unknown, ...rest: unknown[]): void {
    this.write('fatal', message, rest);
  }

  setLogLevels(): void {
    // Levels come from LOG_LEVEL and are fixed for the process lifetime. Nest calls
    // this during bootstrap; honouring it would silently override the configuration.
  }

  private write(level: ConfiguredLevel, message: unknown, rest: unknown[]): void {
    if (SEVERITY.indexOf(level) > this.threshold) return;

    /**
     * Nest passes the context (the class name) as the LAST argument, and an error's
     * stack as the first of the rest. Separating them is what turns "some string" into
     * a queryable `context` field.
     */
    const context = typeof rest.at(-1) === 'string' ? (rest.at(-1) as string) : undefined;
    const extras = context ? rest.slice(0, -1) : rest;

    const request = currentRequestContext();

    const entry: Record<string, unknown> = {
      level,
      time: new Date().toISOString(),
      message: typeof message === 'string' ? message : redact(message),
      ...(context ? { context } : {}),
      ...(request?.requestId ? { requestId: request.requestId } : {}),
      ...(request?.userId ? { userId: request.userId } : {}),
      ...(extras.length > 0 ? { detail: extras.map(redact) } : {}),
    };

    const stream = SEVERITY.indexOf(level) <= 1 ? process.stderr : process.stdout;

    if (this.pretty) {
      const id = request?.requestId ? ` [${request.requestId.slice(0, 8)}]` : '';
      const where = context ? ` [${context}]` : '';

      /**
       * Serialised, not `String(...)`.
       *
       * Nest hands an exception object to `ExceptionsHandler`, and `String(object)` is
       * "[object Object]" — which is what the log said while a 500 was being diagnosed,
       * making the one line that held the cause useless. Errors are already unwrapped by
       * `redact`; anything else is JSON.
       */
      const text =
        typeof entry['message'] === 'string'
          ? entry['message']
          : safeStringify(entry['message']);

      stream.write(
        `${level.toUpperCase().padEnd(5)}${where}${id} ${text}` +
          `${extras.length > 0 ? ` ${safeStringify(extras)}` : ''}\n`,
      );
      return;
    }

    stream.write(`${safeStringify(entry)}\n`);
  }
}

/**
 * Copies a value with sensitive keys replaced.
 *
 * Depth-limited and cycle-safe: a logged object is frequently a request, an ORM row
 * or an error with a `cause` chain, any of which can be deep or self-referential, and
 * a logger that throws while logging an error loses the error.
 */
function redact(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1));
  }

  const output: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = REDACTED_KEYS.has(key.toLowerCase())
      ? '[redacted]'
      : redact(item, depth + 1);
  }

  return output;
}

/** Never throws. A logger that can fail turns a handled error into a crash. */
function safeStringify(value: unknown): string {
  try {
    const seen = new WeakSet<object>();

    return JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'object' && item !== null) {
        if (seen.has(item)) return '[circular]';
        seen.add(item);
      }

      return typeof item === 'bigint' ? item.toString() : item;
    });
  } catch {
    return '{"level":"error","message":"log entry could not be serialised"}';
  }
}
