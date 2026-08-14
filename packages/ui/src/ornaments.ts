/**
 * SAFRA's decorative glyphs.
 *
 * ## Why these are here and not in a message catalogue
 *
 * They are not copy. `۞` is the Arabic *rub el hizb*, used here as the brand mark; `☾` and
 * `✦` mark the three pledges on the home page. None of them is a word, none has a
 * translation, and putting them in a catalogue would ask a translator to render a shape into
 * German — which either produces nonsense or, worse, produces something plausible.
 *
 * They live in `@safra/ui` for the same reason `PasswordField` does: both apps use them, and
 * both apps using the SAME glyph is the requirement. Five copies of `۞` pasted across two
 * apps is five places for one of them to become a lookalike from a different block —
 * indistinguishable on screen, different bytes, and quietly excluded from any font subset
 * built for the real one.
 *
 * The no-hardcoded-text rule therefore does not apply to these, and `docs/i18n.md` records
 * that exception explicitly so nobody has to guess where the line is.
 */

/** The brand mark: Arabic rub el hizb, U+06DE. */
export const ORNAMENT_BRAND = '۞';

/** Crescent, U+263E — marks the first pledge. */
export const ORNAMENT_CRESCENT = '☾';

/** Four-pointed star, U+2726 — marks the second pledge. */
export const ORNAMENT_STAR = '✦';

/*
  `ORNAMENT_SUN` (U+2600) was here as the light half of the theme toggle. Removed 2026-08-14 with
  the toggle's move to drawn icons: nothing rendered it any more, and an exported constant nobody
  uses is the kind of thing the next person restores a use for rather than deletes.

  The crescent stays — the homepage's pledges still set it beside the brand mark and the star.
*/
