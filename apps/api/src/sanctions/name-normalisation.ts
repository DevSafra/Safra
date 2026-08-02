/**
 * Reducing a name to something two spellings of it can share.
 *
 * This is the whole difficulty of screening a Levantine platform against a Latin
 * list. The same person reaches an EU designation as `Muhammad al-Assad`, `Mohammed
 * Al Assad`, `Mohamad Alassad` or `Muḥammad al-ʾAsad`, and a screener who types one
 * must still match a list holding another. Comparing raw strings finds none of them.
 *
 * So both sides are pushed through the same reduction before they meet:
 *
 *   1. Unicode NFKD, then strip combining marks — `ʾAsad` and `Asad` converge, and
 *      Arabic diacritics disappear rather than blocking a match.
 *   2. Lower-case, and collapse punctuation and separators to single spaces, so
 *      `Al-Assad`, `Al Assad` and `AlAssad` are not three different names.
 *   3. Drop the Arabic definite article and common name particles, which are written
 *      inconsistently and carry no distinguishing information.
 *   4. Fold the transliteration families that differ only by convention.
 *
 * Every step LOSES information, deliberately. The output is never displayed and never
 * stored as the name — it exists so a fuzzy comparison has a fair chance, and the
 * reviewer always sees the original.
 */

/**
 * Particles that appear or vanish depending on the transliterator.
 *
 * Removed only as separate tokens, never inside a word: stripping `bin` as a
 * substring would maim `Robin`, and `al` would maim `Salah`.
 */
const PARTICLES = new Set([
  'al',
  'el',
  'ad',
  'ar',
  'as',
  'az',
  'bin',
  'ben',
  'ibn',
  'bint',
  'abu',
  'abd',
  'abdul',
  'abdel',
  'van',
  'von',
  'de',
  'da',
  'del',
  'della',
  'di',
  'du',
  'la',
  'le',
  'the',
  'of',
]);

/**
 * Transliteration families, folded to one spelling.
 *
 * Ordered longest-first where prefixes overlap, so `mohammed` is not half-rewritten
 * by a rule for `mohamed`. Each pattern is anchored to a whole token.
 */
const FOLDINGS: ReadonlyArray<readonly [RegExp, string]> = [
  // Muhammad and its many spellings — by far the most common name involved.
  [/^m[ou]h?a?mm?[ae]d$/, 'muhammad'],
  [/^ahm[ae]d$/, 'ahmad'],
  [/^m[ae]hm[ou]{1,2}d$/, 'mahmud'],
  [/^h[ou]ss?[ae]in$/, 'husayn'],
  [/^h[ae]ss?[ae]n$/, 'hasan'],
  // Youssef / Yousef / Yusef / Yusuf / Yousuf — the double-s and the `ou`
  // digraph vary independently, so both are optional.
  [/^y[o]?u?s+[eou]?f$/, 'yusuf'],
  // Ibrahim / Ibraheem / Ibrahem — the long vowel is written `i`, `ee` or `e`.
  [/^ibrah?(i|ee|e)m$/, 'ibrahim'],
  [/^[ei]sma[ie]l$/, 'ismail'],
  [/^kh?al[ie]d$/, 'khalid'],
  [/^s[ae]l[ie]m$/, 'salim'],
  [/^[ao]m[ae]r$/, 'umar'],
  [/^[ou]th?m[ae]n$/, 'uthman'],
  [/^ass?[ae]d$/, 'asad'],
  [/^sh?[ae]{1,2}kh$/, 'shaykh'],
];

/**
 * Reduces a name for comparison. Returns an empty string when nothing survives,
 * which callers must treat as unmatchable rather than as matching everything.
 */
export function normaliseName(raw: string): string {
  const stripped = raw
    .normalize('NFKD')
    // Combining marks: accents, Arabic harakat, and the transliteration glyphs
    // (ʾ ʿ) that appear in scholarly renderings but never in a typed search.
    .replace(/[\u0300-\u036f\u064b-\u0652\u0670]/g, '')
    .replace(/[\u02bb\u02bc\u02be\u02bf'\u2019`\u00b4]/g, '')
    .toLowerCase()
    // Anything that is not a letter, digit or space becomes a separator.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

  if (stripped.length === 0) return '';

  const tokens = stripped
    .split(/\s+/)
    .map((token) => fold(token))
    .filter((token) => token.length > 0 && !PARTICLES.has(token));

  /**
   * If particles were ALL there was, keep the unfiltered tokens.
   *
   * A name like "Abu Bakr" reduced to nothing would silently match nothing, which
   * for a sanctions check is the dangerous direction to fail in.
   */
  if (tokens.length === 0) {
    return stripped.split(/\s+/).map(fold).join(' ');
  }

  return tokens.join(' ');
}

function fold(token: string): string {
  for (const [pattern, replacement] of FOLDINGS) {
    if (pattern.test(token)) return replacement;
  }

  return token;
}

/**
 * The tokens of a name, for a stricter secondary check.
 *
 * Trigram similarity is generous — it will happily score two unrelated Arabic names
 * as similar because they share common letter runs. Comparing token SETS catches the
 * case where a high score comes from letter overlap rather than shared name parts.
 */
export function nameTokens(raw: string): string[] {
  const normalised = normaliseName(raw);

  return normalised.length === 0 ? [] : normalised.split(' ');
}

/**
 * How many of the shorter name's tokens appear in the longer one.
 *
 * Used to demote a fuzzy hit that shares no actual name part — `Hasan Ibrahim` and
 * `Husayn Ibrahimi` overlap far more as letters than as names.
 */
export function tokenOverlap(a: string, b: string): number {
  const left = new Set(nameTokens(a));
  const right = new Set(nameTokens(b));

  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }

  return shared / Math.min(left.size, right.size);
}
