import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Holds the MapLibre audit exemption to account.
 *
 * ## What is being excused, and on what grounds
 *
 * `package.json` ignores GHSA-jrc7-96c5-q579 — a CRITICAL XSS sanitiser bypass in
 * MapLibre's `DOM.sanitize()`. We cannot patch it: the fix is in `maplibre-gl@6.4.1`, and
 * v6 does not work with `pmtiles@4` or `@protomaps/basemaps@5`, which are what make a
 * self-hosted basemap possible. Verified by swapping only the major — v6 throws before it
 * creates a canvas.
 *
 * The exemption rests on ONE claim: nothing attacker-controlled can reach that sanitiser.
 * The advisory names the paths — "applications rendering untrusted/third-party style
 * attribution strings or user-supplied custom attributions" — and its own stated
 * workaround is "sanitizing the attribute field of a source before passing it down to
 * maplibre". We pass a compile-time constant, so the workaround holds by construction.
 *
 * ## Why this is a test and not a comment
 *
 * «An exemption list decays in the direction of hiding things»: its reason is written once
 * and the code moves underneath it. The day somebody adds a popup carrying a partner's
 * description, or builds an attribution from a template, the excuse silently stops being
 * true and the advisory becomes live — with nothing anywhere to say so.
 *
 * So this asserts that the excuse still describes something IMPOSSIBLE rather than merely
 * something convenient. If it fails, the exemption must come out of `package.json` and the
 * map must find another way.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');

/** Every app that could ever mount a map, not just the one that does today. */
const APPS = ['apps/web/src', 'apps/admin/src', 'apps/partner/src'];

function sources(dir: string): string[] {
  const out: string[] = [];
  const absolute = join(ROOT, dir);

  for (const entry of readdirSync(absolute)) {
    const relative = `${dir}/${entry}`;

    if (statSync(join(ROOT, relative)).isDirectory()) {
      out.push(...sources(relative));
    } else if (
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      /*
        Tests are not scanned, and this one is the reason: its own patterns name every
        call it forbids, so scanning itself made it fail on its own source. A sweep that
        reads the thing doing the sweeping proves nothing about the product.
      */
      !entry.includes('.test.') &&
      !entry.includes('.spec.')
    ) {
      out.push(relative);
    }
  }

  return out;
}

/**
 * Strips block comments before scanning.
 *
 * The sweep looks for CODE that can reach the sanitiser, and prose is not code. Documenting
 * why the price markers are deliberately NOT `new Marker()` made this file fail on the
 * explanation of the very rule it enforces — a sweep that cannot tell a call from a sentence
 * about a call punishes writing the reason down.
 *
 * Conservative on purpose: only comments that START a line — optionally behind the `{` of a
 * JSX comment — which is how every comment in these apps is written. A greedy stripper could
 * swallow an opening sequence inside a string literal and take a real call out of range with
 * it, and this sweep failing OPEN is the outcome that matters: it is the only thing holding a
 * critical advisory's exemption to account.
 *
 * Mutation-tested after the change, by putting a real `new maplibre.Marker(...)` into the map
 * component and confirming this still fails.
 */
function withoutComments(body: string): string {
  return (
    body
      /* A JSX comment — `{/* … *\/}` — as well as a plain one. Both anchored to a line start. */
      .replace(/^[ \t]*\{?\/\*[\s\S]*?\*\/\}?/gm, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')
  );
}

const files = APPS.flatMap(sources).map((file) => ({
  file,
  body: withoutComments(readFileSync(join(ROOT, file), 'utf8')),
}));

describe('the MapLibre sanitiser stays out of reach', () => {
  it('builds every attribution from a plain string literal', () => {
    /*
      A template literal or a variable is the shape the advisory describes. `'…'` cannot
      carry anything a visitor or a partner typed; `` `${…}` `` can, and looks almost
      identical in review.
    */
    const dynamic: string[] = [];

    for (const { file, body } of files) {
      for (const [whole] of body.matchAll(/attribution:\s*[^,\n]+/g)) {
        const value = whole.slice(whole.indexOf(':') + 1).trim();
        const literal = /^'[^'$]*'$/.test(value) || /^"[^"$]*"$/.test(value);

        if (!literal) dynamic.push(`${file} — ${whole.trim()}`);
      }
    }

    expect(dynamic.sort(), 'attributions that are not compile-time constants').toEqual(
      [],
    );
  });

  it('renders no popup, marker or HTML content through MapLibre', () => {
    /*
      The other doors into `DOM.sanitize()`, and the reason the price markers are ordinary
      React elements positioned from `map.project()` rather than MapLibre markers: a
      neighbour's pill carries a PARTNER-SUPPLIED name, and routing that through a marker
      would have walked partner text into the vulnerable path — through a feature that looks
      purely cosmetic. The listing's own area stays a GeoJSON layer, which never goes near
      HTML at all.
    */
    const reached: string[] = [];

    /*
      ## Matched on the CONSTRUCTOR, not on a module named `maplibre`

      This used to look for `new Marker(` and for `maplibre*.Popup` / `maplibre*.Marker`, and
      it had a hole big enough to drive the advisory through: `property-map.tsx` reaches the
      library through an object it calls `built.library`, so

          new built.library.Marker().setLngLat(...).addTo(map)

      matched NEITHER pattern and swept clean. That is not a hypothetical alias — it is the
      shape the file already uses for `built.library.NavigationControl`, so the first marker
      anybody added would have been written that way and this test would have said nothing.

      Found on 2026-09-23 by mutating the map component with a real marker and watching the
      sweep pass. Any receiver now counts, because what makes the call dangerous is the
      CONSTRUCTOR, not the name of the variable holding the module.
    */
    const doors = [
      /* `new Marker(`, `new maplibre.Marker(`, `new built.library.Marker(` — any receiver. */
      /\bnew\s+(?:[A-Za-z_$][\w$]*\s*\.\s*)*(Popup|Marker)\s*\(/g,
      /* The two methods that hand MapLibre a string it will sanitise. */
      /\.\s*(setHTML|setDOMContent)\s*\(/g,
    ];

    for (const { file, body } of files) {
      for (const door of doors) {
        for (const [whole] of body.matchAll(door)) {
          reached.push(`${file} — ${whole.replace(/\s+/g, ' ').trim()}`);
        }
      }
    }

    expect(reached.sort(), 'calls that can hand MapLibre untrusted HTML').toEqual([]);
  });

  it('loads no style from a third party, so no foreign attribution can arrive', () => {
    /*
      A hosted style URL brings its OWN attribution string with it — exactly the
      "third-party style attribution" the advisory names. Ours is assembled in the client
      from files in our own bucket, so there is no style document we did not write.
    */
    const foreign: string[] = [];

    for (const { file, body } of files) {
      for (const [whole] of body.matchAll(/style:\s*'https?:\/\/[^']+'/g)) {
        foreign.push(`${file} — ${whole}`);
      }
      for (const [whole] of body.matchAll(
        /https?:\/\/[^'"`\s]*(maptiler|openfreemap|demotiles|mapbox)[^'"`\s]*/gi,
      )) {
        foreign.push(`${file} — ${whole}`);
      }
    }

    expect(foreign.sort(), 'third-party map styles or tile hosts').toEqual([]);
  });
});
