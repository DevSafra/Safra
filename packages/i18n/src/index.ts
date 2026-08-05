/**
 * `@safra/i18n` — every word SAFRA says to anyone, and nothing else.
 *
 * The rule this package exists to make structural: **no user-facing text is written inside
 * code.** Not in a component, not in a route handler, not in an exception message, not in an
 * email. A string a human reads lives in a catalogue here, keyed, in every locale that
 * surface serves.
 *
 * Not because the copy is precious, but because "add German" has to be a task somebody can
 * finish and verify. A sentence in a `.tsx` file is invisible to that task, and the way you
 * find out it was there is a German customer reading Arabic.
 *
 * ## What lives where
 *
 * | Surface | Catalogue | Locales | Read by |
 * | --- | --- | --- | --- |
 * | Customer site | `messages/web/*.json` | ar · en · de, complete | next-intl |
 * | Staff console | `messages/admin/ar.ts` | ar (see `admin.ts`) | `adminMessages()` |
 * | Transactional email | `messages/email/*.ts` | ar · en · de, complete | `emailMessages()` |
 * | Server errors | `messages/errors/*.ts` | ar · en · de, complete | `errorMessage()` |
 * | Stored content | `messages/content/*.ts` | ar · en · de, complete | `contentMessages()` |
 *
 * The customer catalogues are JSON because next-intl reads them natively, ICU handles the
 * plural and date cases customer copy actually has, and JSON is what a translation service
 * accepts. The rest are TypeScript because `as const` is what lets `fill()` type-check
 * placeholder names — a trade documented in `docs/i18n.md`.
 *
 * ## What is NOT copy
 *
 * Brand marks, ornaments and glyphs (`۞`), currency and enum CODES (`SYP`, `pending_review`),
 * reference prefixes (`BKG-`), and anything a machine reads. Translating a machine identifier
 * breaks the contract that identifies it; those belong in `@safra/ui` or the schema. The
 * distinction matters because the lint rule has to know it too.
 */
export * from './locales.js';
export * from './shape.js';
export * from './fill.js';
export * from './admin.js';
export * from './content.js';
export * from './email.js';
export * from './errors.js';
export * from './web.js';
