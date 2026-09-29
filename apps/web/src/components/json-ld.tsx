import type { Graph } from '@/lib/structured-data';

/**
 * Renders a schema.org graph for a crawler.
 *
 * ## The escaping is not optional
 *
 * `JSON.stringify` will happily produce `</script>` inside a string value — a property named
 * `</script><img onerror=…>` would end the block and start executing. Escaping `<` as `<`
 * keeps the JSON byte-identical in meaning (a JSON parser reads the escape as the same character)
 * while making the sequence impossible to write. Every value in these graphs comes from the
 * database, which is to say from a partner's or an operator's keyboard, so this is the ordinary
 * case rather than a paranoid one.
 *
 * ## No nonce, and that is deliberate — it carried one for a day and cost the theme
 *
 * `type="application/ld+json"` is a DATA BLOCK: the browser never executes it, and `script-src`
 * does not apply to it. The first version read the CSP nonce anyway, as cheap insurance. It was
 * not cheap. `await headers()` in a component rendered inside the page BODY opts that subtree into
 * a dynamic render, and on the property page — three graphs — the layout's pre-paint theme script
 * stopped applying before first paint: `data-theme` was unset at load in four runs out of five,
 * against five out of five on the build before it. The symptom is a THEME FLASH, which is exactly
 * what `ThemeScript` exists to prevent and exactly what nobody would connect to structured data.
 *
 * So this is a plain synchronous component that reads nothing. Held by
 * `e2e/contrast.spec.ts`, whose dark-theme sweep measures at `load` and therefore fails the moment
 * the pre-paint script stops winning.
 *
 * ## Null renders nothing
 *
 * Builders return null when there is nothing worth saying — an FAQ with no questions, a breadcrumb
 * with one step. An empty `FAQPage` is a page claiming to be something it is not, which is exactly
 * what structured-data penalties are for.
 */
export function JsonLd({ graph }: { readonly graph: Graph | null }) {
  if (!graph) return null;

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serialise(graph) }}
    />
  );
}

/** JSON with every `<` escaped, so no value can close the surrounding element. */
export function serialise(graph: Graph): string {
  return JSON.stringify(graph).replaceAll('<', '\\u003c');
}
