# @aglyn/shared-ui-theme

The Material UI theming layer the Aglyn packages share: a responsive theme factory, the console and site default themes, a provider that renders a site's stored theme document as a MUI theme with light and dark schemes, Emotion cache helpers, and WCAG contrast utilities. It is mainly a dependency of the renderer, Besigner and the other `@aglyn/shared-ui-*` packages; the utilities are usable in any MUI app.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-ui-theme@beta

Peer dependencies: `react`, `@mui/material`, `@mui/system`, `@mui/utils`, `@mui/types` and `@mui/styles`. `@emotion/react` and `@emotion/cache` are regular dependencies.

## What's in it

From the root entry:

- **Theme factory.** `createResponsiveTheme({ themeOptions, responsiveFontSizesOptions? })` runs `createTheme`, derives shades for the extra palette colors, repairs derived shades that miss AA contrast, and applies `responsiveFontSizes` across every breakpoint. `createResponsiveCssVarTheme(light, dark, options?)` combines two themes into one CSS-variables theme switched by class.
- **MUI module augmentation.** Importing the package extends MUI's types with the palette additions these themes use (`tertiary`, `surface`, `tint`), extra typography variants such as `displayXl`, and the matching component `color` overrides. It also re-exports a selection of MUI types and helpers (`Theme`, `ThemeOptions`, `SxProps`, `darkScrollbar`, `visuallyHidden`).
- **Default themes.** `consoleThemeLight` / `consoleThemeDark` / `consoleThemeCssVar` / `getConsoleTheme(mode)` and `tenantThemeLight` / `tenantThemeDark`, with their `ThemeOptions` (`consoleOptions`, `tenantOptions` and the dark variants). `siteFallbackTheme(host, scheme)` and `siteBaseOptions(host, scheme)` pick between them for a host.
- **Host theme.** A `HostTheme` (the type lives in `@aglyn/shared-data-types`) is a site's theme customization as plain data. `hostThemeToThemeOptions(theme, scheme)` converts it to `ThemeOptions`; `sanitizeHostTheme`, `mergeThemeOptions`, `hasHostTheme` and `getGoogleFontsUrl` support it. `HostThemeProvider` renders children under it, taking `theme`, a required `fallback` theme or `[light, dark]` pair, `baseOptions`, and `initialMode` / `initialDeviceMode` so a server render can choose the scheme before hydration.
- **Light/dark mode.** `createWithThemeProvider({ theme })` returns a higher-order component that provides the theme and mode state; `useThemeMode()` reads and toggles it. The choice is stored in the `theme-color-mode` cookie (`COOKIE_THEME_KEY`).
- **Emotion.** `createEmotionCache`, `CacheProvider`, `createLayeredEmotionCache`, `createWithEmotionClientCache`, and the constants `EMOTION_CACHE_KEY`, `APP_EMOTION_CACHE_OPTIONS`, `MUI_CSS_LAYER_NAME`.
- **Contrast.** `contrastRatio`, `relativeLuminance`, `meetsContrast`, `accessibleShade`, `accentTextColor`, `accentFillColor`, `auditPaletteContrast`, with `AA_TEXT_CONTRAST` (4.5) and `AA_NON_TEXT_CONTRAST` (3).
- **Small helpers.** `mergeSxProps` / `useMergeSxProps`, `generateComponentClassKeys`, `FontFamily`, `buildFontFamilyList`.

By subpath only: `util/theme-editor-fields` and `util/theme-editor-defaults` (the field vocabulary and readers/writers a theme editor uses over a `HostTheme`), `util/theme-mode-cookie`, `util/color-scheme-hint` and `util/scheme-route-segment` (server-side resolution of the visitor's scheme).

## Usage

```tsx
import {
  contrastRatio,
  createResponsiveTheme,
  createWithThemeProvider,
} from '@aglyn/shared-ui-theme'

const light = createResponsiveTheme({
  themeOptions: { palette: { primary: { main: '#1565c0' } } },
})
const dark = createResponsiveTheme({
  themeOptions: { palette: { mode: 'dark', primary: { main: '#90caf9' } } },
})

const withTheme = createWithThemeProvider({ theme: [light, dark] })

export const App = withTheme(function App() {
  return <main>Hello</main>
})

contrastRatio('#ffffff', '#1565c0') // a number; 4.5 or more passes AA for text
```

```ts
import { parseThemeModeCookie } from '@aglyn/shared-ui-theme/util/theme-mode-cookie'
```

## How it fits

A `shared` UI package. It depends on `@aglyn/shared-data-types`, `@aglyn/shared-util-tools` and `@aglyn/shared-util-vendor`. `@aglyn/shared-ui-jsx`, `@aglyn/shared-ui-jsx-forms`, `@aglyn/shared-ui-next`, the node renderer and Besigner build on it. Shared packages are generic: they import only other shared packages and hold no plugin's domain.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/ui/theme
