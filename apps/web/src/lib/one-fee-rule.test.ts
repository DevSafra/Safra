import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CUSTOMER_FEE_VISIBLE_SETTING } from '@safra/contracts';

/**
 * No customer surface decides for itself whether to NAME the service fee.
 *
 * Bashar, 2026-09-04: *"one shared setting and one consistent pricing rule, without per-surface
 * hard-coding."* That clause is the reason for this sweep, and it is not hypothetical — the fee
 * came off the checkout and off the invoice on 2026-09-03 by two separate pieces of code, each
 * deciding locally with its own comment explaining why. A third surface would have made its own
 * third decision, and the first divergence between two of them is a receipt that itemises a charge
 * the checkout did not.
 *
 * The rule held here: a customer-facing file that names the fee line must reach the decision
 * through `customerFeeVisible` or `customerLines`. Both live in one module; neither can be reached
 * without the setting.
 *
 * A sweep, so it is a floor and not a ceiling — it cannot see a decision made at a distance and
 * passed down as a prop. It sees the shape that has actually gone wrong here, which is the shape
 * worth guarding. Same discipline as `one-slider.test.ts` and `one-dialog.test.ts`.
 */
const ROOT = new URL('../../../../', import.meta.url).pathname;

const CUSTOMER_APP = 'apps/web/src';

/** The rule itself. Every caller goes through it, so it cannot be asked to call itself. */
const THE_RULE = 'apps/web/src/lib/customer-fee.ts';

/**
 * The one file that names the fee line without deciding anything — and it is held to that.
 *
 * `account.ts` DECLARES the invoice line keys as a zod enum. It parses; it renders nothing. The
 * exemption is written as a test rather than as a list entry because an exemption list decays in
 * the direction of hiding things: its reason is written once and the code moves underneath it. The
 * assertion below fails the moment this file grows a branch, which is the moment the exemption
 * stops being true.
 */
const SCHEMA = 'apps/web/src/lib/account.ts';

function sources(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(join(ROOT, dir))) {
    const relative = `${dir}/${entry}`;

    if (statSync(join(ROOT, relative)).isDirectory()) {
      out.push(...sources(relative));
    } else if (
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    ) {
      out.push(relative);
    }
  }

  return out;
}

/**
 * CALLED, not merely imported.
 *
 * The first version of this matched the bare name, which an `import` line satisfies on its own —
 * so a surface that imported the rule and then decided for itself passed the sweep. Checked by
 * mutation: replacing the call with a literal `false` left the import in place and the test green.
 */
const reachesTheRule = (text: string) =>
  /customerFeeVisible\(|customerLines\(/.test(text);

describe('one rule decides whether the fee is named', () => {
  const files = sources(CUSTOMER_APP);

  /*
    The sweep's own control. A walker that silently found nothing would pass every assertion
    below while proving nothing at all — the failure mode that makes an exemption list decay.
  */
  it('walks the customer app', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain(THE_RULE);
  });

  it.each([
    ['the checkout', 'apps/web/src/app/[locale]/checkout/page.tsx'],
    ['the invoice', 'apps/web/src/app/[locale]/account/invoices/[reference]/page.tsx'],
  ])('%s reads the shared setting rather than deciding', (_name, path) => {
    expect(files, 'the file this names still exists').toContain(path);
    expect(reachesTheRule(readFileSync(join(ROOT, path), 'utf8'))).toBe(true);
  });

  it('has no other surface branching on the fee line', () => {
    const rogue = files.filter((file) => {
      if (file === THE_RULE || file === SCHEMA) return false;

      const text = readFileSync(join(ROOT, file), 'utf8');

      return /'serviceFee'|"serviceFee"|`serviceFee`/.test(text) && !reachesTheRule(text);
    });

    expect(rogue).toEqual([]);
  });

  /**
   * The schema file's exemption still describes something that cannot decide.
   *
   * It may NAME the fee line, because it declares the union of line keys the API can send. It may
   * not compare against it, because comparing is deciding. If somebody adds a branch here, this
   * fails and the exemption has to be re-argued rather than silently covering a real defect.
   */
  it('exempts the schema declaration, and holds it to being one', () => {
    const text = readFileSync(join(ROOT, SCHEMA), 'utf8');
    const mentions = text.match(/serviceFee/g) ?? [];

    expect(mentions, 'still names it exactly once').toHaveLength(1);
    expect(text).toMatch(/z\.enum\(\[[^\]]*'serviceFee'/);
    expect(text, 'and never compares against it').not.toMatch(
      /===\s*'serviceFee'|!==\s*'serviceFee'|key === "serviceFee"/,
    );
  });

  /** The key the sweep guards is the key the API publishes, named once in `@safra/contracts`. */
  it('checks the key the API actually publishes', () => {
    expect(CUSTOMER_FEE_VISIBLE_SETTING).toBe('commission.customer_fee_visible');
  });
});
