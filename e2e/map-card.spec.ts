import { expect, test } from '@playwright/test';

/**
 * A map inside a rounded card stays inside its corners (Bashar, 2026-10-02, screenshot «15.20.53»
 * and «the map still has the same issue. It is not rounded»).
 */
test.use({ baseURL: 'http://localhost:3000' });

/**
 * The map card shows a PICTURE of the map, not a live WebGL canvas (Bashar, 2026-10-02, twice:
 * «It is not rounded», screenshot «15.20.53»). His browser drew the canvas's square corners over
 * the card's rounded ones through `overflow` + `border-radius` and then through a `clip-path`; no
 * engine available here reproduced it, so the canvas is copied into an `<img>` once drawn and the
 * map closed. An image is clipped the same way everywhere. Asked: a picture, no canvas left, and
 * the picture inside the border, under a rounded clip.
 */
test('the map card is a rounded picture of the map, not a live canvas', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/ar/city/damascus');

  const card = page.locator('[data-map-thumbnail]');
  const picture = card.locator('img[data-map-picture]');
  await expect(picture).toBeVisible({ timeout: 15_000 });
  await expect(picture).toHaveAttribute('src', /^data:image\//);
  await expect(card.locator('canvas')).toHaveCount(0);
  await card.hover();

  const geometry = await card.evaluate((element) => {
    const clip = element.querySelector<HTMLElement>('[data-map-thumbnail-clip]');
    const image = element.querySelector('img[data-map-picture]');
    const outer = element.getBoundingClientRect();
    const border = parseFloat(getComputedStyle(element).borderTopWidth);
    const inner = clip?.getBoundingClientRect();
    return {
      clipPath: clip ? getComputedStyle(clip).clipPath : 'no clip layer',
      pictureInsideClip: !!clip && !!image && clip.contains(image),
      insideBorder:
        !!inner &&
        inner.top >= outer.top + border - 0.5 &&
        inner.left >= outer.left + border - 0.5 &&
        inner.right <= outer.right - border + 0.5 &&
        inner.bottom <= outer.bottom - border + 0.5,
    };
  });

  expect(geometry.clipPath).toMatch(/^inset\(0(px)? round /);
  expect(geometry.pictureInsideClip).toBe(true);
  expect(geometry.insideBorder).toBe(true);
});

/** The property page's location card holds a WebGL map in its bottom corners: the same fault. */
test('the location card on a stay clips its map with a rounded clip-path', async ({
  page,
}) => {
  await page.goto('/ar/property/grand-umayyad-hotel');
  const card = page.locator('#location > div').filter({ has: page.locator('figure') });
  await expect(card).toHaveCount(1);
  expect(await card.evaluate((element) => getComputedStyle(element).clipPath)).toMatch(
    /^inset\(0(px)? round /,
  );
});

/**
 * On a dense map a dot never sits on a price (Bashar, 2026-10-03: Aleppo's full map read
 * «$101.�99» where a neighbour's dot landed in the middle of a pill). Asked of EVERY pill in view:
 * the point at its centre must belong to the pill, not to anything drawn over it.
 */
test('no dot is drawn over a price pill on a dense map', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/ar/city/aleppo');
  await page.locator('[data-map-thumbnail] button').click();
  const dialog = page.getByRole('dialog', { name: 'الإقامات على الخريطة' });
  await expect(dialog).toBeVisible();
  const list = dialog.getByRole('region', { name: 'الإقامات في هذه المنطقة' });
  await expect(list.locator('li').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  const pills = dialog.locator('a.pill-gold-hover.inline-flex');

  /* A grid across the text, not one point: a 12px dot covers part of a price, rarely its centre. */
  const covered = await pills.evaluateAll((links) =>
    links.flatMap((link) => {
      const box = link.getBoundingClientRect();
      if (box.width === 0 || box.bottom < 0 || box.top > innerHeight) return [];
      for (const fx of [0.2, 0.35, 0.5, 0.65, 0.8])
        for (const fy of [0.35, 0.5, 0.65]) {
          const hit = document.elementFromPoint(
            box.left + box.width * fx,
            box.top + box.height * fy,
          );
          if (!hit || (hit !== link && !link.contains(hit)))
            return [link.textContent ?? ''];
        }
      return [];
    }),
  );

  expect(await pills.count(), 'the map drew enough pills to be dense').toBeGreaterThan(
    10,
  );
  expect(covered, 'pills with something drawn over their centre').toEqual([]);
});
