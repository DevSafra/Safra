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
