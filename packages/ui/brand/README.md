# SAFRA logo — files

The symbol is a map pin carrying a roof and the road that leads to it: the destination, the stay,
the journey. Everything is vector, the lettering is already outlined (no font loads), and every
file comes in a dark-mode and a light-mode version using the platform's own gold and text colours.

## Quickest route: the React component (follows `data-theme` by itself)

Copy `react/SafraLogo.tsx` into `packages/ui/src/` and export it from the package index. It paints
with `var(--color-gold)` and `var(--color-text)`, so it switches with the theme toggle like every
other element — nothing to wire up.

```tsx
import { SafraLogo } from '@safra/ui';

// Header (replaces the ۞ tile and the text wordmark)
<Link href={`/${locale}`} aria-label={brand('name')}>
  <SafraLogo lang={locale === 'ar' ? 'ar' : 'en'} height={34} title="" />
</Link>

// Footer brand block
<SafraLogo variant="stacked" lang="ar" height={160} />

// Symbol alone (buttons, loaders, empty states, map markers)
<SafraLogo variant="symbol" height={40} />
<SafraLogo variant="symbol-small" height={16} />   // simplified cut, use at 24 px and below
```

## Static files (`svg/`, `png/`)

| Use                                          | File                                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| One-line logo, Arabic / English              | `svg/logo-ar-{dark,light}.svg`, `svg/logo-en-{dark,light}.svg`                                                             |
| Stacked logo (both languages, one leads)     | `svg/logo-stacked-ar-*.svg`, `svg/logo-stacked-en-*.svg`                                                                   |
| Symbol only                                  | `svg/symbol-{dark,light}.svg` · small cut: `svg/symbol-small-*.svg`                                                        |
| Favicon / app icon (works on any tab colour) | `svg/favicon.svg`, `png/favicon-16.png`, `-32`, `-48`, `png/apple-touch-icon-180.png`, `png/icon-192.png`, `-512`, `-1024` |
| Raster logos for email, social, documents    | `png/logo-*@120px.png`, `png/logo-stacked-*@600px.png`, `png/symbol-*@512px.png`                                           |

Put the icons in `apps/web/public/` and add to the root layout's metadata:

```tsx
icons: {
  icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/favicon-32.png', sizes: '32x32' }],
  apple: '/apple-touch-icon-180.png',
}
```

## Rules of thumb

- Minimum height: one-line logo 28 px, symbol 24 px; below that use `symbol-small` (no lane marks, bolder roof).
- Clear space: keep at least a quarter of the pin's height free around the logo.
- Dark mode uses gold `#E8BC66` on night; light mode uses gold `#A87A1F` on day. The symbol is one colour, so it also works in print and single-ink contexts as it is.
