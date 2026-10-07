import { describe, expect, it } from 'vitest';

import { robotsPolicy } from './robots';

/** `/robots.txt` per deployment (audit 2026-10-06: it answered 404). */
describe('robotsPolicy', () => {
  it('opens a real https origin and links its sitemap on that origin', () => {
    const policy = robotsPolicy('https://booking.example', undefined);

    expect(policy.sitemap).toBe('https://booking.example/sitemap.xml');
    expect(policy.rules).toMatchObject({ userAgent: '*', allow: '/' });
  });

  /* The failure this guards: production shipped with «Disallow: /», invisible to every engine. */
  it('never disallows the whole site on a production origin', () => {
    const rules = robotsPolicy('https://booking.example', undefined).rules;
    const disallow = (Array.isArray(rules) ? rules : [rules]).flatMap((rule) =>
      rule.disallow === undefined ? [] : [rule.disallow].flat(),
    );

    expect(disallow).not.toContain('/');
    expect(disallow).toEqual(expect.arrayContaining(['/*/account', '/*/checkout']));
  });

  it.each(['off', 'OFF', ' off '])(
    'closes a deployment that sets SITE_INDEXING=%j',
    (flag) => {
      expect(robotsPolicy('https://staging.example', flag)).toStrictEqual({
        rules: { userAgent: '*', disallow: '/' },
      });
    },
  );

  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://localhost',
    'http://booking.example',
    'not a url',
  ])('closes a development origin, %s, whatever the flag says', (origin) => {
    expect(robotsPolicy(origin, 'on').rules).toStrictEqual({
      userAgent: '*',
      disallow: '/',
    });
  });
});
