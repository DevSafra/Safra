import type { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';

/**
 * How large a JSON body may be, and where.
 *
 * ## Two limits, because one is wrong either way
 *
 * Express defaults to 100kb and says nothing about it. That is right for the two hundred routes
 * that carry a form, and wrong for the three that carry a base64 PDF: a generated partnership
 * agreement is ~400KB, about 540KB encoded, so every real signed copy was refused while every test
 * passed — the fixtures were 68-byte PDFs. Bashar hit it on the first genuine upload (2026-08-21).
 *
 * Raising it globally would let any endpoint buffer 15MB before a guard or a schema ever runs,
 * which is a memory target on every route to fix a problem on three. So the large limit is scoped
 * to the two path prefixes that take a file, and everything else keeps the small one.
 *
 * Partner documents and property images are unaffected: they arrive as multipart, which
 * `body-parser` never sees.
 */
export const DEFAULT_BODY_LIMIT = '100kb';

/**
 * 10MB of file plus base64's 4/3 expansion plus the JSON envelope, rounded up.
 *
 * A file over `MAX_BYTES` is refused by the route's own schema with a coded 400, which is a better
 * answer than a truncated parse — so this ceiling exists to let that refusal happen, not to be the
 * refusal itself.
 */
export const FILE_BODY_LIMIT = '15mb';

/** The prefixes that carry a base64 file. Everything else keeps the default. */
export const FILE_BODY_PATHS = [
  '/api/v1/admin/partner-contracts',
  '/api/v1/partner/contracts',
] as const;

/**
 * Registers both parsers, in the order that makes them work.
 *
 * ## The ordering is load-bearing, and getting it wrong is silent
 *
 * `body-parser` skips a request whose body is already parsed, so whichever parser runs first is the
 * one whose limit applies. The scoped ones therefore go first.
 *
 * ## And the second call is not redundant
 *
 * `ExpressAdapter.registerParserMiddleware` skips Nest's own default parser when the router stack
 * already holds a handler named `jsonParser` — and `express.json()` returns a function with exactly
 * that name. So mounting a scoped parser silently disables body parsing on every OTHER route.
 *
 * That failure is worth spelling out because of how it presents. It is not a crash and not a 500:
 * it is every endpoint in the platform quietly deciding its request has no body, so a sign-in
 * starts answering «expected object, received undefined» and it reads as a validation bug in
 * whatever you happen to be testing. It shipped for about ten minutes on 2026-08-21 and was caught
 * by hand, which is why `body-parsers.test.ts` exists.
 *
 * `useBodyParser` registers unconditionally and carries the `rawBody` option through, so the
 * payment webhooks keep the untouched bytes their signature check depends on.
 */
export function configureBodyParsers(app: NestExpressApplication): void {
  for (const path of FILE_BODY_PATHS) {
    app.use(path, json({ limit: FILE_BODY_LIMIT }));
  }

  app.useBodyParser('json', { limit: DEFAULT_BODY_LIMIT });
}
