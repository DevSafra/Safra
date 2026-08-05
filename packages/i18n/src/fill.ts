/**
 * Placeholder substitution for catalogue strings.
 *
 * ## Why templates and not functions
 *
 * The staff console's copy used to interpolate with JavaScript functions:
 *
 * ```ts
 * inviteSent: (email: string) => `أُرسلت الدعوة إلى ${email}.`
 * ```
 *
 * That cannot be translated. A template literal fixes the order of its parts at the point it
 * is written, and word order is the first thing that changes between languages — German puts
 * the participle last, Arabic puts the verb first. A translator handed that function has to
 * edit code to move a value, which is how you end up with a catalogue that is really a
 * source file.
 *
 * `'أُرسلت الدعوة إلى {email}.'` can be reordered freely, and every locale states its own
 * order. The cost is that arity is no longer checked by a function signature — which is why
 * `Placeholder` below recovers it from the string itself.
 */

/**
 * The placeholder names inside a template, as a union of literal types.
 *
 * `Placeholder<'{n} of {total}'>` is `'n' | 'total'`. This is what makes the substitution
 * type-safe without a hand-written signature per string: the compiler reads the names out of
 * the copy, so a renamed placeholder breaks the call site rather than silently rendering
 * `{n}` to a user.
 *
 * Requires the catalogue to be `as const`. A plain `string` type carries no literals and
 * would degrade this to `never`, accepting anything — which the `literal-types` test guards.
 */
export type Placeholder<S extends string> =
  S extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholder<Rest> : never;

/** The values a template needs, keyed by the names it actually contains. */
export type Values<S extends string> = Record<Placeholder<S>, string | number>;

/**
 * What `fill` accepts as its second argument, in three cases.
 *
 * The first case is the one that needs explaining. A catalogue read through a locale-aware
 * accessor has its values widened to `string` (see `Translated`), and `Placeholder<string>`
 * is `never` — `string` does not match a template pattern. Without this branch, `fill()` on a
 * widened template would insist on taking no arguments, and every interpolated call site
 * would stop compiling the moment a second locale was added.
 *
 * So a widened template accepts an unchecked record: the compiler has nothing left to read,
 * and the `completeness` tests take over by asserting placeholders agree across locales.
 * Literal templates — which is everything today — stay exactly checked.
 */
type Args<S extends string> = string extends S
  ? [values?: Readonly<Record<string, string | number>>]
  : [Placeholder<S>] extends [never]
    ? []
    : [values: Values<S>];

/**
 * Substitutes `{name}` placeholders in a catalogue string.
 *
 * The second argument is required exactly when the template has placeholders and rejected
 * when it does not, so `fill(t.title)` and `fill(t.count, { n: 3 })` are both correct and
 * neither of the two mistakes compiles.
 *
 * `[Placeholder<S>] extends [never]` rather than the bare form: a naked type parameter in a
 * conditional distributes over unions, which would test each placeholder name separately and
 * answer the wrong question for a template with more than one.
 *
 * ## `NoInfer` is what makes any of this actually work
 *
 * Without it, TypeScript treats the VALUES as inference candidates for `S` as well as the
 * template. Pass a `string`-typed value — which every real call site does — and `S` becomes
 * `'…{email}.' | string`, which collapses to `string`, which takes the first branch of `Args`
 * and accepts anything. The checking silently switched itself off, and only ever appeared to
 * work when tested with literal values:
 *
 * ```ts
 * fill(t.staff.inviteSent, { emial: 'literal' })  // caught
 * fill(t.staff.inviteSent, { emial: email })      // NOT caught, before NoInfer
 * ```
 *
 * `NoInfer<S>` confines inference to the template, where the placeholder names are.
 */
export function fill<S extends string>(template: S, ...args: Args<NoInfer<S>>): string {
  const values = args[0] as Record<string, string | number> | undefined;

  if (!values) return template;

  /*
    Replaced in ONE pass over the template rather than a loop of `replace` per key. A value
    that itself contains `{something}` — a property name, a partner's legal name — must not
    then be rescanned and substituted a second time.
  */
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name];

    return value === undefined ? match : String(value);
  });
}

/** Every placeholder name in a template, at runtime. Used by the completeness tests. */
export function placeholdersOf(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined)
    .sort();
}
