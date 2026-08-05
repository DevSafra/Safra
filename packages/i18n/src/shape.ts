/**
 * The structural type of a catalogue, with its values widened to `string`.
 *
 * ## The problem this solves
 *
 * Catalogues are `as const` so that `fill()` can read placeholder names out of the literal
 * types. That same `as const` makes two locales structurally incompatible:
 *
 * ```ts
 * const CATALOGUES: Record<Locale, typeof ar> = { ar, en, de };
 * //                                                  ^^ Type '"Reset your SAFRA password"'
 * //                                                     is not assignable to type
 * //                                                     '"إعادة تعيين كلمة المرور — سفرة"'
 * ```
 *
 * Which is correct, and useless: of course the German subject is not the Arabic subject —
 * that is what a translation is. What we want checked is the SHAPE, so a locale missing a key
 * or inventing one fails to compile, while its values are free to differ.
 *
 * `Translated<typeof ar>` is that shape: every key preserved, every leaf `string`. It is the
 * type a registry of locales is keyed by, and the type a new catalogue is checked against.
 *
 * Reaching for `Record<string, unknown>` here instead would waive the whole guarantee, and
 * with it the reason the copy was moved out of the components.
 */
export type Translated<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : Translated<T[K]>;
};
