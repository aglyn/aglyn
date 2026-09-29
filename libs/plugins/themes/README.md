# @aglyn/plugins-themes

Built-in themes for an Aglyn site's theme picker (**Setup → Theme**):

- **Bootstrap** — Bootstrap 5.3's palette and dark mode, the system font stack, flat bordered
  cards, compact inputs and focus rings.
- **Minimal** — neutral zinc, Inter, hairline borders and no elevation, in the style of
  shadcn/ui.
- **Material 3** — Material Design 3's baseline roles, tonal surfaces, pill buttons and the M3
  type scale.

Each is a plain-JSON `HostTheme` (palette for both schemes, fonts, typography, shape and
component overrides, including theme-aware `sx` and `variants`), contributed through
`ConsoleExtension.themePresets`.

## What it reads, stores and sends

Nothing. The plugin registers data with the console and has no server surface. A site that
picks one of these themes gets a copy of it on its own host document, and its edits are stored
as an override on that copy, so the published site never loads this package.

## Status

`private` until the npm name is created and trusted.
