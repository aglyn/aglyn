# @aglyn/plugins-fonts

Fonts for Aglyn sites (AGL-3656).

- **The Google Fonts catalog.** Every family Google serves, with its category, the weights and
  italics it offers, its variation axes, the scripts it covers, its popularity rank and the metrics
  of its regular face, in `src/lib/catalog/google-fonts.catalog.json`. Written by
  `npm run generate:google-fonts-catalog`, which reads Google's public metadata and measures each
  family's Latin regular file with this plugin's own font reader. Run it when Google adds families
  and review the diff.
- **The theme font catalog.** `serverDeclarations` registers the catalog as core's theme font
  catalog (`@aglyn/aglyn/plugin-manager/plugin-theme-font-catalog`). A published page asks it
  which weights a family offers, whether it has a variable file, and the metrics its local
  fallback is sized to. The page itself is built by core's loader
  (`@aglyn/tenant-runtime/self-hosted-fonts` and `@aglyn/shared-ui-theme/util/self-hosted-fonts`),
  because a site's fonts are part of its theme.
- **The font file reader.** `src/lib/font-file/read-font-file.ts` reads a TrueType or OpenType
  font's family, style, weight, variation axes, OS/2 `fsType` license and metrics, with no
  dependencies, so the catalog generator, the server and the browser all read a font one way.

## How a published page loads its fonts

1. The loader works out the faces the theme draws with: the weights its fonts list, every text
   style's weight whose family is that font (the platform ramp sets `h1` in 900 and `h2` in 800),
   the theme's named weights, and one italic at the body weight. Each is mapped to the nearest
   weight the family offers.
2. For a family with a variable file, it compares the variable Latin file with the static files
   for the weights the text styles use, by their real sizes, and serves whichever is smaller.
3. Every `@font-face` is inlined in the page with `font-display: swap`, every file is on the site's
   own origin (`/api/fonts/…` for Google's files, `/api/media/cdn/…?v=…` for a site's uploads), and
   each family gets a local fallback face (`Inter Fallback`, drawn from Arial, Times New Roman or
   Courier New) with `size-adjust` and ascent, descent and line-gap overrides computed from the
   font's metrics. The theme's stacks name the fallback right after the family, so the text drawn
   before the font arrives takes the font's box.
4. The body face and the headline face are preloaded. Nothing else is.
5. A site on system fonts adds nothing. An operator host whose theme names no family loads the
   brand's face, Roboto Flex; a customer site's default stack is the system stack.

No page asks Google for anything: a render that cannot read Google leaves the family out and draws
in its sized fallback until the next render.

## What it reads, stores and sends

The catalog is data in the package. The server asks Google's CSS2 API for a theme's stylesheets and
passes Google's font files through the site's own `/api/fonts` route; a visitor's browser never
contacts Google for a theme font.
