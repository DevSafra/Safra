import { ERROR, type ErrorCode } from './error-codes.js';
import { PASSWORD_MIN_LENGTH } from './password-length.js';

/**
 * Whether a password is strong enough to protect a wallet balance and a payout account.
 *
 * ## What this adds, and what it deliberately does not
 *
 * The policy was twelve characters and nothing else, on the reasoning — correct, and kept — that
 * **length beats composition**: forcing "one symbol" produces `Password1!`, which is weaker than
 * four ordinary words. That is NIST SP 800-63B's position too.
 *
 * What was missing is the other half of the same guidance, which is not optional: **a password must
 * be checked against the ones people actually choose.** Without it, `aaaaaaaaaaaa`,
 * `123456789012`, `qwertyuiop12` and `Password1234` were all accepted (2026-08-14). Twelve
 * characters of one letter is not twelve characters of entropy, and every one of those is in the
 * first thousand guesses of any real attack.
 *
 * So: still no composition rules, still no forced symbols, still no expiry. Five refusals, each for
 * something that makes a password guessable rather than for a shape somebody dislikes.
 *
 * ## Every check runs on the SERVER
 *
 * These live in the schema, so the API's validation pipe enforces them on every route that accepts
 * a password. The customer app parses the same schema before calling the API, which makes the
 * message immediate — but that is a convenience, and the boundary that counts is the API's.
 *
 * ## What would be stronger, and why it is not here
 *
 * A breach corpus. `HaveIBeenPwned`'s range API answers "has this hash prefix been seen" without
 * learning the password, and it covers hundreds of millions of real leaked passwords rather than
 * the few hundred below. It is an outbound call to a third party on the registration path, which is
 * an approval and an availability question rather than an engineering one — recorded in
 * `docs/FUTURE-WORK.md` rather than decided here.
 */

/**
 * The fewest distinct characters a password may be built from.
 *
 * `abababababab` is twelve characters and two of them. Six is low enough not to trouble a real
 * passphrase — «كلمة سر طويلة» and "correct horse battery staple" are far above it — and high
 * enough to refuse a keyboard mash of one or two keys.
 */
const MIN_DISTINCT_CHARACTERS = 6;

/** `aaaa` — four of anything in a row is a held key, not a choice. */
const MAX_REPEAT_RUN = 4;

/** `12345`, `abcde`. Five is short enough to catch a padded sequence inside a longer string. */
const MAX_SEQUENCE_RUN = 5;

/** The shortest identity fragment worth refusing. Below this it is a coincidence, not a leak. */
const MIN_IDENTITY_FRAGMENT = 4;

/**
 * The passwords people actually pick.
 *
 * A few hundred rather than a few million: this list ships to the browser inside `@safra/contracts`,
 * and the value of the ten-thousandth entry is far below the cost of shipping it. It covers the
 * shapes that dominate real credential stuffing — keyboard walks, the word "password" and its
 * decorations, years, names, and the Arabic-market equivalents — and `normalise` below is what makes
 * a short list go a long way: `P@ssw0rd!2024` and `password` collapse to the same entry.
 */
const COMMON = new Set([
  'password',
  'passwort',
  'passe',
  'pass',
  'letmein',
  'welcome',
  'admin',
  'administrator',
  'root',
  'login',
  'user',
  'guest',
  'test',
  'demo',
  'secret',
  'changeme',
  'default',
  'temporary',
  'qwerty',
  'qwertyuiop',
  'qwertz',
  'azerty',
  'asdfgh',
  'asdfghjkl',
  'zxcvbn',
  'zxcvbnm',
  'qazwsx',
  'qweasd',
  'wasd',
  'abc',
  'abcd',
  'abcdef',
  'abcdefg',
  'abcdefgh',
  'iloveyou',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'basketball',
  'superman',
  'batman',
  'starwars',
  'pokemon',
  'shadow',
  'master',
  'michael',
  'jennifer',
  'jordan',
  'harley',
  'ranger',
  'hunter',
  'buster',
  'thomas',
  'robert',
  'daniel',
  'andrew',
  'joshua',
  'matthew',
  'freedom',
  'whatever',
  'trustno',
  'computer',
  'internet',
  'samsung',
  'google',
  'facebook',
  'apple',
  'amazon',
  'netflix',
  'liverpool',
  'chelsea',
  'arsenal',
  'barcelona',
  'realmadrid',
  'juventus',
  'flower',
  'summer',
  'winter',
  'spring',
  'autumn',
  'january',
  'february',
  'march',
  'april',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'money',
  'love',
  'hello',
  'helloworld',
  'ninja',
  'access',
  'flowers',
  'purple',
  'orange',
  'silver',
  'golden',
  'diamond',
  'phoenix',
  'matrix',
  'nothing',
  'forever',
  'together',
  'family',
  'friends',
  'happy',
  'lovely',
  'beautiful',
  'angel',
  'baby',
  'kitten',
  'puppy',
  'cookie',
  'chocolate',
  'coffee',
  'pizza',
  'burger',
  /* Arabic-market equivalents, transliterated the way people type them on a Latin keyboard. */
  'habibi',
  'habibti',
  'salam',
  'salamalikum',
  'assalam',
  'marhaba',
  'ahlan',
  'yalla',
  'inshallah',
  'mashallah',
  'alhamdulillah',
  'bismillah',
  'allah',
  'mohamed',
  'mohammed',
  'muhammad',
  'ahmed',
  'ahmad',
  'mahmoud',
  'mustafa',
  'fatima',
  'khaled',
  'omar',
  'ali',
  'hassan',
  'hussein',
  'youssef',
  'yousef',
  'ibrahim',
  'abdullah',
  'damascus',
  'dimashq',
  'aleppo',
  'halab',
  'homs',
  'hama',
  'latakia',
  'tartus',
  'syria',
  'suriya',
  'souria',
  'lebanon',
  'beirut',
  'jordan',
  'amman',
  'palestine',
  'quds',
  /*
    Arabic script. The transliterations above cover a Latin keyboard; these cover the one most of
    this site's readers actually type on, and omitting them meant the blocklist did nothing for
    them at all.
  */
  'كلمةالسر',
  'كلمةالمرور',
  'مرحبا',
  'اهلا',
  'اهلاوسهلا',
  'السلامعليكم',
  'حبيبي',
  'حبيبتي',
  'ياالله',
  'اللهاكبر',
  'بسمالله',
  'الحمدلله',
  'انشاءالله',
  'ماشاءالله',
  'محمد',
  'احمد',
  'علي',
  'فاطمة',
  'سوريا',
  'دمشق',
  'حلب',
  'حمص',
  'اللاذقية',
  'طرطوس',
  'لبنان',
  'بيروت',
  'الاردن',
  'عمان',
  'فلسطين',
  'القدس',
  'سفرة',
  /* The service itself. A password named after the site it protects is the first one tried. */
  'safra',
  'safrasafra',
]);

/**
 * Keyboard rows and the alphabet, forwards. Reversed forms are checked by reversing the input, so
 * `54321` and `fedcba` are caught without a second list.
 */
const SEQUENCES = [
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  'qwertzuiop',
  'azertyuiop',
];

/**
 * Folds the decorations people add to a common password so the short list above catches them.
 *
 * `P@ssw0rd!2024` → `password`. Without this the list would need every variant of every entry,
 * which is how blocklists reach a hundred thousand rows and still miss the next one.
 *
 * ## The ORDER of the steps is the whole thing
 *
 * The decoration is stripped from the ENDS first, then leetspeak is folded. The first version did
 * it the other way and quietly failed: folding turns the `4` of `2024` into an `a`, so the trailing
 * digits are no longer trailing digits and `Password1234` normalised to `passwordi2ea` — which
 * matches nothing, and the password was accepted. Caught by probing the built package rather than
 * by reading the code.
 *
 * ## Arabic letters survive
 *
 * They used to be stripped along with the punctuation, which made every Arabic-script password
 * normalise to the empty string and skip the blocklist entirely — on the site whose primary
 * language is Arabic. The list carries Arabic entries for the same reason.
 *
 * Exported for the tests, which assert the folding rather than only its consequences.
 */
export function normalise(password: string): string {
  const lower = password.toLowerCase();

  /*
    The year, the counter, the exclamation mark: whatever sits at either END and is not a letter.
    `2024password!` and `password2024` both reduce to the word somebody actually chose.
  */
  const core = lower
    .replace(/^[^a-z\u0600-\u06ff]+/, '')
    .replace(/[^a-z\u0600-\u06ff]+$/, '');

  /* An all-digit password strips to nothing; fall back so the checks below still see something. */
  return (core || lower)
    .replace(/[4@]/g, 'a')
    .replace(/[3€]/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/9/g, 'g')
    .replace(/[^a-z0-9\u0600-\u06ff]/g, '');
}

/** True when a run of one character reaches `MAX_REPEAT_RUN`. */
function hasRepeatRun(password: string): boolean {
  let run = 1;

  for (let index = 1; index < password.length; index += 1) {
    run = password[index] === password[index - 1] ? run + 1 : 1;

    if (run >= MAX_REPEAT_RUN) return true;
  }

  return false;
}

/** True when the password contains a straight run along a keyboard row or the alphabet. */
function hasSequenceRun(password: string): boolean {
  const lower = password.toLowerCase();
  const reversed = [...lower].reverse().join('');

  return SEQUENCES.some((sequence) => {
    for (let start = 0; start + MAX_SEQUENCE_RUN <= sequence.length; start += 1) {
      const window = sequence.slice(start, start + MAX_SEQUENCE_RUN);

      if (lower.includes(window) || reversed.includes(window)) return true;
    }

    return false;
  });
}

/**
 * The reason a password is refused, or null when it is acceptable.
 *
 * Returns a CODE rather than a sentence: the reader's language is not known here, and the same
 * refusal is rendered by the API for its logs and by the customer app for the person typing.
 *
 * Length is NOT checked here — `passwordSchema` owns the bounds, and duplicating them would give
 * two places to change one number.
 */
export function passwordWeakness(password: string): ErrorCode | null {
  if (new Set(password).size < MIN_DISTINCT_CHARACTERS) {
    return ERROR.VALIDATION_PASSWORD_PREDICTABLE;
  }

  if (hasRepeatRun(password) || hasSequenceRun(password)) {
    return ERROR.VALIDATION_PASSWORD_PREDICTABLE;
  }

  const folded = normalise(password);

  if (COMMON.has(folded)) return ERROR.VALIDATION_PASSWORD_COMMON;

  /*
    A common password doubled is still a common password. `passwordpassword` folds to a repetition
    of one entry, which the set alone would miss — and doubling is the single most common way people
    reach a longer minimum.
  */
  for (let size = 3; size <= folded.length / 2; size += 1) {
    const unit = folded.slice(0, size);

    if (
      unit.repeat(Math.ceil(folded.length / size)).startsWith(folded) &&
      COMMON.has(unit)
    ) {
      return ERROR.VALIDATION_PASSWORD_COMMON;
    }
  }

  return null;
}

/**
 * Whether the password gives away, or is given away by, who the person is.
 *
 * A password containing the local part of your own email is one an attacker holding a leaked
 * address list writes down first. Same for your name and for the name of the service.
 *
 * Separate from `passwordWeakness` because it needs CONTEXT the password field does not have — the
 * schema applies it where the surrounding object carries an email, which is registration. A reset
 * or an invitation acceptance carries only a token, and the API resolves the account from it, so
 * the check belongs there rather than in a shape that cannot see it.
 */
export function passwordEchoesIdentity(
  password: string,
  context: { readonly email?: string | undefined; readonly name?: string | undefined },
): boolean {
  const folded = normalise(password);

  if (folded.length === 0) return false;

  const fragments = [
    context.email?.split('@')[0] ?? '',
    ...(context.name ?? '').split(/\s+/),
  ]
    .map((fragment) => normalise(fragment))
    .filter((fragment) => fragment.length >= MIN_IDENTITY_FRAGMENT);

  return fragments.some(
    (fragment) => folded.includes(fragment) || fragment.includes(folded),
  );
}

/**
 * The requirements a person sees ticked off as they type.
 *
 * ## Composition rules, added deliberately and against the earlier reasoning
 *
 * The policy was length plus a blocklist and no composition rules, on the grounds — NIST's, and
 * still true — that forcing a symbol produces `Password1!`. Bashar asked for the visible checklist
 * anyway (2026-08-14), and the trade is worth stating plainly: the checklist teaches people what
 * "strong" means and gives immediate feedback, at the cost of narrowing the space slightly.
 *
 * **The blocklist is what makes that trade safe.** `Password1!` satisfies every rule below and is
 * still refused, because `passwordWeakness` folds it to `password`. Composition and blocklist
 * together are stronger than either; composition alone would have been weaker than what was here.
 *
 * ## Why `uppercase` and `lowercase` are not `\p{Lu}` and `\p{Ll}`
 *
 * **Arabic has no case.** A literal "one capital letter" rule cannot be satisfied by «مطر أزرق فوق
 * الجبل» — or by Hebrew, Persian, Chinese or Hindi — so the rule as drawn would have refused every
 * password written in this site's primary language and quietly forced everyone onto a Latin
 * keyboard. That is not a strength requirement, it is a script requirement.
 *
 * So a caseless letter satisfies both. A password written in Latin must still have both cases; one
 * written in Arabic is judged on the rules that mean something for it.
 *
 * ## One definition, two consumers
 *
 * The schema refines against this array and the meter renders it. A checklist that showed one set
 * of rules while the server enforced another is a form that refuses a password it just told you was
 * acceptable — which is worse than having no meter at all.
 */
export const PASSWORD_RULES = [
  { id: 'length', test: (password: string) => password.length >= PASSWORD_MIN_LENGTH },
  {
    id: 'uppercase',
    test: (password: string) => /\p{Lu}/u.test(password) || hasCaselessLetter(password),
  },
  {
    id: 'lowercase',
    test: (password: string) => /\p{Ll}/u.test(password) || hasCaselessLetter(password),
  },
  { id: 'digit', test: (password: string) => /\p{Nd}/u.test(password) },
  { id: 'symbol', test: (password: string) => /[^\p{L}\p{N}]/u.test(password) },
] as const;

export type PasswordRuleId = (typeof PASSWORD_RULES)[number]['id'];

/**
 * A letter from a script that HAS no case — Arabic, Hebrew, Persian, Chinese, Hindi.
 *
 * `\p{Lo}` is Unicode's "Letter, other": the category for exactly those. Its presence is what makes
 * the two case rules satisfiable outside the Latin alphabet.
 */
function hasCaselessLetter(password: string): boolean {
  return /\p{Lo}/u.test(password);
}

/** Which requirements a password currently meets. What the meter renders, live, as somebody types. */
export function passwordRuleResults(
  password: string,
): { readonly id: PasswordRuleId; readonly met: boolean }[] {
  return PASSWORD_RULES.map((rule) => ({ id: rule.id, met: rule.test(password) }));
}

/**
 * How full the bar is: met requirements out of all of them, 0 to 1.
 *
 * Requirements met, NOT an entropy estimate. A bar that claimed to measure strength would be
 * lying — it cannot see the blocklist, and `Password1!` would fill it completely while being
 * refused. It measures what the checklist beside it measures, which is the only honest thing for
 * the two to agree on.
 */
export function passwordProgress(password: string): number {
  const met = passwordRuleResults(password).filter((rule) => rule.met).length;

  return met / PASSWORD_RULES.length;
}
