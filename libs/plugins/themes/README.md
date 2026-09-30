# @aglyn/plugins-themes

Built-in themes for an Aglyn site's theme picker (**Setup → Theme**):

- **Material UI** — MUI's own default theme, as its default theme viewer documents it: Roboto,
  the stock type scale and palettes, 4px corners and the stock component defaults. (The
  platform's default theme is not this: it draws MUI's colors in the platform's own type.)
- **Bootstrap** — Bootstrap 5.3's palette and dark mode, the system font stack, flat bordered
  cards, compact inputs and focus rings.
- **Minimal** — neutral zinc, Inter, hairline borders and no elevation, in the style of
  shadcn/ui.
- **Material 3** — Material Design 3's baseline roles, tonal surfaces, pill buttons and the M3
  type scale.
- **Ant Design** — Ant Design 5's default tokens and dark algorithm, 14px type, 32px controls,
  the hairline "default" button and its pill switch.
- **Fluent** — Microsoft Fluent 2's brand and neutral tokens, Segoe UI with the Fluent ramp,
  inputs underlined in the brand on focus, and depth from its shadow ramp.
- **Carbon** — IBM Carbon's White and g100 themes, IBM Plex Sans with light display type,
  square corners, filled fields and the green toggle.
- **Cupertino** — in the style of iOS: the system face with Dynamic Type sizes, grouped
  backgrounds, capsule and tinted buttons, segmented tabs and the green switch.

Each is a plain-JSON `HostTheme` (palette for both schemes including tertiary, fonts, every
text style the platform defines, shape and component overrides, including theme-aware `sx` and `variants`), contributed through
`ConsoleExtension.themePresets`.

## What it reads, stores and sends

Nothing. The plugin registers data with the console and has no server surface. A site that
picks one of these themes gets a copy of it on its own host document, and its edits are stored
as an override on that copy, so the published site never loads this package.

## Status

`private` until the npm name is created and trusted.
