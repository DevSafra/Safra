import { describe, expect, it } from 'vitest';

import { applyTheme, themeCookie, themeScript, themeStorageKey } from './theme.js';

/**
 * The keys are namespaced per app, and this is the test that keeps them that way.
 *
 * One shared name was a real bug, not a tidiness question: a cookie is scoped to a HOST and ignores
 * the PORT, so `localhost:3000`, `:3001` and `:3002` shared one jar. The console and لوحة الشريك are
 * designed DARK, so using either toggle turned the CUSTOMER site dark — and because the customer
 * layout reads the cookie during a server render, it surfaced on the next navigation, which made it
 * look like the language switcher's fault (Bashar, 2026-08-18).
 *
 * Asserted as "all three differ" rather than against literal strings: the names may change, the
 * property that must not is that no two surfaces can ever collide.
 */
describe('theme keys', () => {
  const SURFACES = ['web', 'admin', 'partner'] as const;

  it('gives every surface its own cookie', () => {
    const names = SURFACES.map(themeCookie);

    expect(new Set(names).size).toBe(SURFACES.length);
  });

  it('gives every surface its own storage key', () => {
    const keys = SURFACES.map(themeStorageKey);

    expect(new Set(keys).size).toBe(SURFACES.length);
  });

  /* The pre-paint script reads storage, so it has to read the SAME key `applyTheme` wrote. */
  it('has each script read its own surface key', () => {
    for (const surface of SURFACES) {
      expect(themeScript(surface)).toContain(themeStorageKey(surface));
    }

    for (const other of SURFACES) {
      const foreign = SURFACES.filter((s) => s !== other).map(themeStorageKey);

      for (const key of foreign) expect(themeScript(other)).not.toContain(key);
    }
  });

  /**
   * The end-to-end property, in one assertion: a choice made on one surface is invisible to another.
   *
   * This is the bug reproduced at the unit level — before the fix, both writes landed on one name
   * and the second surface read the first one's value.
   */
  it('does not let one surface read another surface choice', () => {
    const jar = new Map<string, string>();

    /* Stand-ins for the browser, keyed the way a real cookie jar is: by NAME, not by port. */
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        setItem: (k: string, v: string) => void jar.set(k, v),
        getItem: (k: string) => jar.get(k) ?? null,
      },
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        documentElement: { dataset: {} as Record<string, string> },
        set cookie(value: string) {
          const [pair] = value.split(';');
          const [name, v] = (pair ?? '').split('=');

          if (name && v) jar.set(name, v);
        },
      },
    });
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { protocol: 'http:' },
    });

    applyTheme('dark', 'admin');

    /* The console's choice is stored… */
    expect(jar.get(themeCookie('admin'))).toBe('dark');
    expect(jar.get(themeStorageKey('admin'))).toBe('dark');
    /* …and the customer site has nothing to read. */
    expect(jar.get(themeCookie('web'))).toBeUndefined();
    expect(jar.get(themeStorageKey('web'))).toBeUndefined();
  });
});
