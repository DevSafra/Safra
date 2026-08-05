/**
 * `no-hardcoded-text` — user-facing copy must come from `@safra/i18n`.
 *
 * The rule Bashar set (2026-08-04): no words or sentences written directly inside the code, so
 * that adding a language is a task somebody can finish rather than an archaeology exercise. This
 * is the part that makes it structural. A convention is remembered by whoever was in the room; a
 * lint rule is remembered by CI.
 *
 * ## What it flags
 *
 * 1. **JSX text** — `<p>Booking not found</p>`
 * 2. **User-facing JSX attributes** — `placeholder`, `title`, `alt`, `aria-label`, `label`
 * 3. **Exception messages** — `new BadRequestException('Booking not found.')`
 *
 * ## What it does NOT flag, and why each exception is real
 *
 * Getting these wrong is what makes a rule like this get switched off, so they are narrow and
 * each one names its reason:
 *
 * - **The catalogues themselves.** `packages/i18n/src/messages/**` IS the copy.
 * - **Anything with no letters.** `·`, `—`, `✓`, `←`, `%`, `{' '}`. Punctuation and separators
 *   have no language. This single check removes most of what a naive version shouts about.
 * - **Machine identifiers.** `snake_case`, `SCREAMING_CASE`, `kebab-case`, dotted paths
 *   (`booking.not_found`), and single words with no spaces that are not obviously prose. An enum
 *   value, a CSS class, a URL, a header name and a template key are all read by machines;
 *   translating one breaks the thing that identifies it.
 * - **Tests.** A fixture is data about what a server returned, not copy shown to anyone.
 * - **Technical strings** matched by shape: URLs, MIME types, file extensions, ISO codes.
 *
 * ## What it deliberately CANNOT catch
 *
 * A prose string passed to a function it does not know about — `setError('Try again')`. Covering
 * that would mean flagging every string literal in the repo, which is a rule nobody keeps. The
 * three shapes above are where user-facing copy actually accumulated in this codebase; the
 * `scan` script in `docs/i18n.md` is the broader sweep for the rest.
 */

/** Any letter, in any script we serve — Latin, Arabic, or anything else. */
const HAS_LETTERS = /\p{L}/u;

/** Two or more letter-runs separated by a space: the signature of prose rather than a token. */
const LOOKS_LIKE_PROSE = /\p{L}+\s+\p{L}/u;

/** Attributes a person reads. `name`, `id`, `className`, `href` are not among them. */
const USER_FACING_ATTRIBUTES = new Set([
  'alt',
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'label',
  'placeholder',
  'title',
]);

/**
 * Exception constructors whose first argument reaches a CLIENT.
 *
 * Nest's HTTP exceptions only. A plain `new Error('Wallet insert returned no rows')` is a
 * developer diagnostic for an invariant that should be impossible: it never reaches a browser —
 * Nest answers a generic 500 and the text goes to the log, which is exactly where rule 1 wants
 * it. Flagging those would push internal diagnostics into a user-facing catalogue, which is the
 * opposite of the point.
 */
const CLIENT_FACING_EXCEPTION =
  /^(BadRequest|Unauthorized|Forbidden|NotFound|Conflict|Gone|PayloadTooLarge|UnsupportedMediaType|UnprocessableEntity|TooManyRequests|InternalServerError|NotImplemented|BadGateway|ServiceUnavailable|GatewayTimeout|Http)Exception$/;

/** Shapes that are technical by construction, whatever letters they contain. */
const TECHNICAL = [
  /^https?:\/\//, // a URL
  /^[a-z]+:\/\//, // any other scheme
  /^\/[\w/[\]().-]*$/, // a path or route
  /^[\w.-]+\/[\w.+-]+$/, // a MIME type
  /^\.[a-z0-9]+$/i, // a file extension
  /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/i, // snake_case
  /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/, // SCREAMING_SNAKE_CASE
  /^[a-z0-9]+(-[a-z0-9]+)+$/i, // kebab-case
  /^[a-z][\w]*(\.[a-z][\w]*)+$/i, // a dotted identifier: booking.not_found
  /^[A-Z]{2,4}-\d/, // a reference prefix: BKG-2026-000431
  /^[\d\s.,:%+×x/-]+$/, // digits and separators
];

function isTechnical(text) {
  return TECHNICAL.some((pattern) => pattern.test(text));
}

/**
 * Whether a string is copy a person reads.
 *
 * Prose (two words) always counts. A single word counts only if it is not a machine identifier —
 * `Search` is copy, `sea_view` is a key, `SAFRA` is a brand mark.
 */
function isCopy(raw) {
  const text = raw.trim();

  if (text.length < 2) return false;
  if (!HAS_LETTERS.test(text)) return false;
  if (isTechnical(text)) return false;
  if (LOOKS_LIKE_PROSE.test(text)) return true;

  // A lone all-caps token is an acronym or a brand mark, not a sentence.
  if (text === text.toUpperCase()) return false;

  // A lone camelCase or PascalCase token is an identifier.
  if (/^[a-z]+([A-Z]\w*)+$/.test(text) || /^[A-Z][a-z]+([A-Z]\w*)+$/.test(text)) {
    return false;
  }

  return true;
}

/** Files that are allowed to contain copy, because they ARE the copy. */
function isCatalogue(filename) {
  return (
    filename.includes('packages/i18n/src/messages/') ||
    filename.includes('packages\\i18n\\src\\messages\\')
  );
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'User-facing text must come from a catalogue in @safra/i18n, never be written inline.',
    },
    schema: [],
    messages: {
      jsxText:
        'Hardcoded UI text: "{{text}}". Move it to a catalogue in @safra/i18n and read it through `t`.',
      attribute:
        'Hardcoded text in `{{attribute}}`: "{{text}}". A person reads this attribute, so it belongs in a catalogue.',
      thrown:
        'Hardcoded message in `{{constructor}}`: "{{text}}". Throw an error CODE instead — see apps/api/src/common/errors/app-error.ts.',
    },
  },

  create(context) {
    if (isCatalogue(context.filename)) return {};

    return {
      JSXText(node) {
        if (!isCopy(node.value)) return;

        context.report({
          node,
          messageId: 'jsxText',
          data: { text: node.value.trim().slice(0, 40) },
        });
      },

      JSXAttribute(node) {
        const name = node.name.name;

        if (typeof name !== 'string' || !USER_FACING_ATTRIBUTES.has(name)) return;
        if (node.value?.type !== 'Literal') return;
        if (typeof node.value.value !== 'string' || !isCopy(node.value.value)) return;

        context.report({
          node: node.value,
          messageId: 'attribute',
          data: { attribute: name, text: node.value.value.slice(0, 40) },
        });
      },

      NewExpression(node) {
        if (
          node.callee.type !== 'Identifier' ||
          !CLIENT_FACING_EXCEPTION.test(node.callee.name)
        ) {
          return;
        }

        const [first] = node.arguments;

        if (!first) return;

        /*
          A template literal counts too — that is the form most of the API's messages had, and
          the interpolation is exactly what made them look like structure rather than copy.
        */
        const text =
          first.type === 'Literal' && typeof first.value === 'string'
            ? first.value
            : first.type === 'TemplateLiteral'
              ? first.quasis.map((quasi) => quasi.value.cooked ?? '').join(' ')
              : null;

        if (text === null || !isCopy(text)) return;

        context.report({
          node: first,
          messageId: 'thrown',
          data: { constructor: node.callee.name, text: text.trim().slice(0, 40) },
        });
      },
    };
  },
};

export default rule;
