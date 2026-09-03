import { expect, test, type Page } from '@playwright/test';

/**
 * «معاينة» — the one image previewer, driven.
 *
 * Every assertion here corresponds to something that was wrong on 2026-09-02 and that no unit test
 * could see: the component rendered, returned no errors, and looked finished. It is exercised
 * through the CUSTOMER site because that is the surface where two of the defects were exclusive —
 * the undefined token and the frame that used 44% of the screen — but the component is shared, so
 * fixing it here fixed the console's property review, the partner's image manager, the dispute
 * evidence panel and the campaign creative at the same time.
 */
test.use({ baseURL: 'http://localhost:3000' });

/** A published listing with more than one photograph, so the rail and stepping have something to do. */
const GALLERY = '/ar/property/qasr-al-sharq-apartments';

/**
 * The picture being SHOWN, not the rail's thumbnails and not the neighbours.
 *
 * The frame is a track: it mounts the current picture and the two either side of it so a drag can
 * slide onto them, so «the image in the dialog» stopped identifying one element on 2026-09-02.
 * `data-current` is the slide's own answer to which one is on screen.
 */
const PICTURE = '[role="dialog"] [data-current="true"] img';

/**
 * Opens the frame and waits for the entrance to FINISH before anything is measured.
 *
 * Not politeness — correctness. The frame enters at `scale(0.985)`, and `getBoundingClientRect()`
 * reports the PAINTED box, so a 44px control measures 43.3px for the 200ms the transition runs. A
 * test that raced it failed against a build where nothing was wrong, which is the expensive kind of
 * flake: it accuses the code. WCAG measures a control at rest, and so does this.
 */
async function openPreview(page: Page, path = GALLERY) {
  await page.goto(path);
  /*
    A gallery TILE, not a «عرض كل الصور» button. The mosaic replaced that single control on
    2026-09-02: every photograph on the page opens the previewer at its own picture now, which is
    what a person expects when they press the one of the bathroom.
  */
  await page.locator('[data-gallery-tile]').first().click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();

  await page.waitForFunction(() => {
    const dialog = document.querySelector('[role="dialog"]');

    if (!dialog) return false;

    const { scale } = getComputedStyle(dialog);

    /* Chromium reports the settled value as `1`; a browser that never scaled reports `none`. */
    return scale === '1' || scale === 'none';
  });
}

/**
 * Waits for the track to stop moving.
 *
 * The picture area is a track that slides for 260ms, and `getBoundingClientRect` reports the moving
 * geometry — so a test that steps and then immediately measures or presses is aiming at a box that
 * is no longer there. The same trap as the entrance: everything here is measured at rest, because
 * that is what a person meets.
 *
 * Two identical frames rather than a fixed sleep, so the wait is as short as the machine allows and
 * still correct on a slow one.
 */
async function settled(page: Page) {
  /*
    The remembered frame is cleared first, so the very first comparison cannot match. Without it two
    reads taken before a transition has even STARTED are identical, and the helper reports «at rest»
    for an animation that has not begun.
  */
  await page.evaluate(() => {
    delete (window as unknown as { __last?: string }).__last;
  });

  await page.waitForFunction(() => {
    const slide = document.querySelector<HTMLElement>('[role="dialog"] [data-current]');
    const track = slide?.parentElement;
    const picture = slide?.querySelector('img');

    if (!track || !picture) return false;

    /*
      BOTH transforms. The track carries the slide between pictures and the picture carries the
      zoom, and they are separate transitions — a helper that watched only the track reported «at
      rest» while a zoom was still growing, and the test then measured a magnification of 1.67 on
      its way to 2.
    */
    const now = `${getComputedStyle(track).transform}|${getComputedStyle(picture).transform}`;
    const previous = (window as unknown as { __last?: string }).__last;

    (window as unknown as { __last?: string }).__last = now;

    return previous === now;
  });
}

/**
 * The controls were 30×23px.
 *
 * They asked for `min-w-10 min-h-10` and computed `0`, because `globals.css` carried its
 * shrink-to-fit rule outside a cascade layer. 23px is under WCAG 2.5.8's 24×24 floor, on a modal
 * dialog, in all three apps. `responsive.spec.ts` never caught it: its sweep walks static routes and
 * this frame only exists after somebody presses something.
 *
 * Asserted at DESKTOP as well as phone. The old classes released the floor at `lg` deliberately, so
 * a phone-only assertion would have passed against the broken build.
 */
for (const width of [390, 1440]) {
  test(`every control in the preview is at least 44px at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await openPreview(page);

    const small = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');

      return (
        Array.from(dialog?.querySelectorAll('button') ?? [])
          .map((button) => ({
            label: button.getAttribute('aria-label') ?? '?',
            box: button.getBoundingClientRect(),
          }))
          /*
          Rounded before comparing. A control laid out at exactly 44px reports 43.999… from
          `getBoundingClientRect`, because the rect is the painted geometry and the compositor works
          in sub-pixels — comparing the raw float fails a box that is correct by construction.
        */
          .filter(({ box }) => Math.round(box.width) < 44 || Math.round(box.height) < 44)
          .map(
            ({ label, box }) =>
              `${label} ${Math.round(box.width)}x${Math.round(box.height)}`,
          )
      );
    });

    expect(small).toStrictEqual([]);
  });
}

/**
 * The picture uses the room the frame reserves for it.
 *
 * `max-w-full` only ever shrinks, so an unsized `<img>` rendered at its intrinsic width: a source
 * sat 640px wide in the middle of a 1440px viewport and used 44% of it. Asserted as a PROPORTION of
 * the area the frame gives it rather than as a pixel figure, so a different fixture cannot make this
 * pass or fail for the wrong reason.
 */
test('the picture fills the space the frame gives it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await openPreview(page);

  const fill = await page.evaluate((selector) => {
    const image = document.querySelector<HTMLImageElement>(selector);
    const area = image?.parentElement;

    if (!image || !area) return 0;

    /*
      Two boxes, and both are needed. The PICTURE's real size comes from the image element's own box
      with `object-contain` applied inside it; the space it was offered is the parent's box.
      Comparing the picture to its own element instead reports a perfect fill for the exact defect
      this exists to catch — `max-*` sizing shrinks the element onto the picture, so the two are the
      same thing by construction. The first version of this test did that and stayed green against
      the mutation.
    */
    const own = image.getBoundingClientRect();
    const offered = area.getBoundingClientRect();
    const shown = Math.min(
      own.width / image.naturalWidth,
      own.height / image.naturalHeight,
    );

    /* How much of the constraining axis the picture actually covers. */
    return Math.max(
      (image.naturalWidth * shown) / offered.width,
      (image.naturalHeight * shown) / offered.height,
    );
  }, PICTURE);

  expect(fill).toBeGreaterThan(0.98);
});

/**
 * Tab is trapped, Escape closes, and focus goes back where it came from.
 *
 * `aria-modal="true"` announces a modal to a screen reader and traps nothing: Tab walked straight
 * out of this dialog into the page behind it, which is modal in appearance only.
 */
test('the preview holds focus and gives it back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await openPreview(page);

  for (let press = 0; press < 14; press += 1) {
    await page.keyboard.press('Tab');

    const inside = await page.evaluate(() =>
      document.querySelector('[role="dialog"]')?.contains(document.activeElement),
    );

    expect(inside, `focus left the dialog after ${press + 1} tabs`).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);

  /* The trigger, not the top of the document. */
  const returned = await page.evaluate(() =>
    document.activeElement?.hasAttribute('data-gallery-tile'),
  );

  expect(returned, 'focus went back to the tile that was pressed').toBe(true);
});

/**
 * The arrow keys step, and they step the way the on-screen controls point.
 *
 * `→` is the next picture on every screen, Arabic included — the standing rule, because an arrow key
 * means a direction of travel rather than a reading direction. The whole viewer follows it: the
 * chevrons are placed physically, a leftward drag goes onward, and the rail is `dir="ltr"` so its
 * highlight travels the same way the right-hand control sends it.
 */
test('the arrow keys step forward and back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await openPreview(page);

  const shown = () => page.locator(PICTURE).getAttribute('src');
  const first = await shown();

  await page.keyboard.press('ArrowRight');
  await expect.poll(shown).not.toBe(first);

  await page.keyboard.press('ArrowLeft');
  await expect.poll(shown).toBe(first);
});

/**
 * Pressing the chevrons moves the picture.
 *
 * Bashar, 2026-09-02: «the arrows buttons of the image preview are not working». They were not:
 * the gesture lived on a wrapper that called `setPointerCapture` on every press, and capturing
 * retargets every later pointer event to the capturing element — so `pointerup` never reached the
 * chevron, and a `click` only fires when down and up share a target. The buttons received nothing
 * at all.
 *
 * **This spec had six tests and none of them pressed one.** It checked that the chevrons were the
 * right size, and that they sat in the right places, and that the arrow KEYS stepped — all of which
 * passed against a build where the controls did nothing. A control is tested by using it.
 */
test('pressing the chevrons moves through the set', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await openPreview(page);

  const shown = () => page.locator(PICTURE).getAttribute('src');
  const first = await shown();

  await page.locator('[role="dialog"] button[aria-label="الصورة التالية"]').click();
  await expect.poll(shown).not.toBe(first);

  await page.locator('[role="dialog"] button[aria-label="الصورة السابقة"]').click();
  await expect.poll(shown).toBe(first);
});

/**
 * A control with nowhere to go is absent, not greyed out.
 *
 * The track slides between neighbours, so stepping clamps rather than wraps — sliding from the last
 * picture back past every other one to reach the first reads as the viewer losing its place, and
 * booking.com's gallery does not wrap either. The ends are where that decision becomes visible.
 */
test('the chevrons disappear at the ends of the set', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await openPreview(page);

  const previous = page.locator('[role="dialog"] button[aria-label="الصورة السابقة"]');
  const next = page.locator('[role="dialog"] button[aria-label="الصورة التالية"]');

  await expect(previous).toHaveCount(0);
  await expect(next).toBeVisible();

  const thumbs = page.locator('[role="dialog"] [data-thumb]');

  await thumbs.last().click();

  await expect(next).toHaveCount(0);
  await expect(previous).toBeVisible();
});

/**
 * «السابق» is under the same hand as `←`, on an Arabic page and on a German one.
 *
 * The alternative — mirroring the chevrons into reading order — puts «التالي» on the left of an
 * Arabic screen while `→` still advances, so the screen and the keyboard point opposite ways. This
 * is the assertion that keeps the four mechanisms agreeing.
 */
test('the step controls sit in the same physical places in both directions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 850 });

  for (const [locale, previous, next] of [
    ['ar', 'الصورة السابقة', 'الصورة التالية'],
    ['de', 'Vorheriges Foto', 'Nächstes Foto'],
  ] as const) {
    await openPreview(page, `/${locale}/property/qasr-al-sharq-apartments`);

    const control = (label: string) =>
      page.locator(`[role="dialog"] button[aria-label="${label}"]`);
    const middle = 1440 / 2;

    /*
      Asserted one chevron at a time, because the fixture holds two pictures and the controls hide
      at the ends — there is no index where both are present. What matters is the SIDE each appears
      on, and that it is the same side on an Arabic page as on a German one.
    */
    await expect(control(previous)).toHaveCount(0);

    const forward = await control(next).boundingBox();

    expect(forward?.x ?? -1, `${locale}: «next» is on the right`).toBeGreaterThan(middle);

    await page.locator('[role="dialog"] [data-thumb]').last().click();
    await settled(page);

    await expect(control(next)).toHaveCount(0);

    const back = await control(previous).boundingBox();

    expect(back?.x ?? 9999, `${locale}: «previous» is on the left`).toBeLessThan(middle);

    await page.keyboard.press('Escape');
  }
});

/**
 * The rail says which picture, not just how many.
 *
 * A position counter tells a reader how far through they are; fourteen photographs stepped one at a
 * time is a search. Pressing a thumbnail must select it, and the marked thumbnail must be the one on
 * screen — a rail whose highlight disagreed with the picture would be worse than no rail.
 */
test('the rail selects a picture and marks the one being shown', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await openPreview(page);

  const thumbs = page.locator('[role="dialog"] [data-thumb]');

  expect(await thumbs.count()).toBeGreaterThan(1);

  const before = await page.locator(PICTURE).getAttribute('src');

  await thumbs.nth(1).click();
  await expect.poll(() => page.locator(PICTURE).getAttribute('src')).not.toBe(before);

  await expect(page.locator('[role="dialog"] [aria-current="true"]')).toHaveAttribute(
    'aria-label',
    /2$/,
  );
});

/**
 * Zoom, which Bashar asked for on 2026-09-02.
 *
 * It had been left out deliberately — booking.com's own lightbox has none — and «add zoom in and
 * zoom out buttons» settles that: the brief wins.
 *
 * The ladder is four stops, and both ends are asserted. A zoom control that keeps counting past the
 * point where a 1600px render turns to mush is a control that produces mush.
 */
test('the zoom buttons magnify the picture and stop at both ends', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await openPreview(page);

  const zoomIn = page.locator('[role="dialog"] button[aria-label="تكبير الصورة"]');
  const zoomOut = page.locator('[role="dialog"] button[aria-label="تصغير الصورة"]');
  const magnification = () =>
    page.evaluate((selector) => {
      const found = getComputedStyle(
        document.querySelector(selector) as Element,
      ).transform.match(/matrix\(([^)]+)\)/);

      return found ? Number(found[1]?.split(',')[0]) : 1;
    }, PICTURE);

  /* Nothing to give back at 1×, so the control says so rather than doing nothing when pressed. */
  await expect(zoomOut).toBeDisabled();
  await expect(zoomIn).toBeEnabled();

  await zoomIn.click();
  await expect.poll(magnification).toBeGreaterThan(1);
  await expect(zoomOut).toBeEnabled();

  await zoomIn.click();
  await zoomIn.click();
  await settled(page);
  await expect(zoomIn).toBeDisabled();

  const ceiling = await magnification();

  /*
    Polled, not read once after a settle. `settled` answers «nothing is moving», which is true both
    after a transition and in the instant before one starts — so a single read can catch the value
    the button was pressed to change. Polling asks the question the test actually has.
  */
  await zoomOut.click();
  await expect.poll(magnification).toBeLessThan(ceiling);
});

/**
 * Magnified, a drag moves the PICTURE — and cannot throw it off its own frame.
 *
 * Zoom without panning is a control that appears to work and does not: it magnifies the middle of a
 * photograph and refuses to show the rest. The clamp is measured from the picture rather than from
 * the element, because `object-contain` letterboxes a landscape shot in a tall frame and panning to
 * the bar is panning into nothing.
 */
test('panning moves the magnified picture and stops at its edge', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await openPreview(page);

  const zoomIn = page.locator('[role="dialog"] button[aria-label="تكبير الصورة"]');

  for (let press = 0; press < 3; press += 1) await zoomIn.click();

  await settled(page);

  const shift = () =>
    page.evaluate((selector) => {
      const found = getComputedStyle(
        document.querySelector(selector) as Element,
      ).transform.match(/matrix\(([^)]+)\)/);
      const parts = found ? found[1]?.split(',').map(Number) : undefined;

      return Math.round(parts?.[4] ?? 0);
    }, PICTURE);

  expect(await shift()).toBe(0);

  /* 600px of travel, entirely inside the viewport — a drag that leaves it is pinned by the driver. */
  await page.mouse.move(1100, 425);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) await page.mouse.move(1100 - step * 50, 425);
  await page.mouse.up();

  const moved = Math.abs(await shift());

  expect(moved, 'the picture followed the drag').toBeGreaterThan(100);
  expect(moved, 'and stopped before its own edge left the frame').toBeLessThan(600);

  /* And it panned rather than stepping: a drag on a magnified picture is not a page turn. */
  await expect(
    page.locator('[role="dialog"] [data-thumb][aria-current="true"]'),
  ).toHaveAttribute('aria-label', /1$/);
});

/**
 * A new picture arrives at 1×.
 *
 * Carrying the zoom across would land somebody on a photograph they have not seen, magnified into a
 * corner of it, with nothing on screen saying they are not looking at the whole thing.
 */
test('stepping to another picture resets the zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await openPreview(page);

  await page.locator('[role="dialog"] button[aria-label="تكبير الصورة"]').click();
  await expect(
    page.locator('[role="dialog"] button[aria-label="تصغير الصورة"]'),
  ).toBeEnabled();

  await page.keyboard.press('ArrowRight');
  await settled(page);

  await expect(
    page.locator('[role="dialog"] button[aria-label="تصغير الصورة"]'),
  ).toBeDisabled();
});

/**
 * A phone can move through the set with a finger.
 *
 * Before this the only way through a set on a handset was a chevron, and that chevron was 30×23px —
 * so the honest description is that there was no way through a set on a handset.
 *
 * The gesture is emulated here, which proves the LOGIC and not the feel; the thresholds and the
 * velocity cut-off want a real device.
 */
test.describe('with a finger', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('dragging moves onward, and dragging down puts the frame away', async ({
    page,
  }) => {
    await openPreview(page);

    const first = await page.locator(PICTURE).getAttribute('src');
    const box = await page.locator(PICTURE).boundingBox();

    expect(box).not.toBeNull();

    const middle = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    const from = (box?.x ?? 0) + (box?.width ?? 0) * 0.75;

    await page.mouse.move(from, middle);
    await page.mouse.down();
    for (let stop = 1; stop <= 6; stop += 1)
      await page.mouse.move(from - stop * 25, middle);
    await page.mouse.up();

    await expect.poll(() => page.locator(PICTURE).getAttribute('src')).not.toBe(first);
    await settled(page);

    const again = await page.locator(PICTURE).boundingBox();
    const centre = (again?.x ?? 0) + (again?.width ?? 0) / 2;
    const top = (again?.y ?? 0) + 40;

    await page.mouse.move(centre, top);
    await page.mouse.down();
    for (let stop = 1; stop <= 8; stop += 1)
      await page.mouse.move(centre, top + stop * 25);
    await page.mouse.up();

    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });
});
