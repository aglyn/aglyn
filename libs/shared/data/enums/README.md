# @aglyn/shared-data-enums

Constants, enums and small pure helpers shared across the Aglyn packages: HTTP codes, CSS value parsing, palette-token CSS variables, MUI `sx` alias expansion, icon constants and environment flags. It is mainly a dependency of the larger `@aglyn/*` packages, and the helpers are usable on their own.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-data-enums@beta

Peer dependency: `firebase`. The `firebase-auth` module imports error codes and types from `firebase/auth`, and the root entry re-exports that module.

## What's in it

The root entry re-exports every module below. Each is also importable on its own as `@aglyn/shared-data-enums/<module>`.

- `http` — the `HttpStatusCode`, `HttpRequestMethod` and `HttpResponseStatus` enums, the `HttpRefCode*` enums and `createHttpRefCode`.
- `styles` — `CssUnit`, `parseCssDimension` / `buildCssDimension`, `parseCssGradient` / `buildCssGradient`, `isCssGradientValue`, `describeCssColorProblem`, `parseCssMeasurement` / `buildCssMeasurement`. Values a parser cannot model come back as `raw` and serialize unchanged.
- `palette-token-css-var` (re-exported through `styles`) — converts between a palette token path and its `var(--mui-palette-…)` form: `paletteTokenToCssVar`, `parsePaletteTokenCssVar`, `paletteTokenToAlphaCssVar`, `cssColorToChannel` and related functions.
- `sx-property-aliases` — `SX_PROPERTY_ALIASES`, `expandSxAliases`, `isSxAliasProperty`, `canonicalSxProperties`, `sxAliasesFor`.
- `breakpoint-span` — `SPAN_BREAKPOINTS`, `parseBreakpointSpan`, `buildBreakpointSpan`.
- `data-table` — helpers for a rows-of-strings table value: `parseDataTableRows`, `serializeDataTable`, `readPastedDataTable`, `withRowAdded`, `withColumnAdded`, `withCellSet` and their counterparts.
- `icons` — `ICON_VARIANT_*` constants, each an icon object from `@aglyn/shared-data-mdi`.
- `firebase-auth` — `AuthAppErrorCodes`, `AuthErrorMessage`, `AuthErrorNotice`, `AuthErrorIgnore` and the related types.
- `global` — flags read from `process.env` (`IS_PRODUCTION`, `IS_DEVELOPMENT`, `IS_TEST`, `PACKAGE_VERSION`, the Firebase emulator flags) and `HAS_WINDOW` / `HAS_DOCUMENT`.
- `aglyn`, `aglyn-applications` — Aglyn's own brand and application name constants (`BRAND`, `PRODUCT_NAME`, `APP_CONSOLE`, `APP_TENANT`, `APP_WWW`).

## Usage

```ts
import {
  CssUnit,
  HttpStatusCode,
  buildCssDimension,
  parseCssDimension,
} from '@aglyn/shared-data-enums'

parseCssDimension('12px') // { value: 12, unit: CssUnit.PIXELS }
parseCssDimension('calc(100% - 2rem)') // { raw: 'calc(100% - 2rem)' }
buildCssDimension({ value: 1.5, unit: CssUnit.EM }) // '1.5em'

HttpStatusCode.OK // 200
```

A single module, without the rest of the barrel:

```ts
import { expandSxAliases } from '@aglyn/shared-data-enums/sx-property-aliases'
```

## How it fits

A `shared` data package. It depends only on other shared packages (`@aglyn/shared-data-mdi`, `@aglyn/shared-util-tools`), and the core (`@aglyn/aglyn`), tenant, Besigner and plugin packages depend on it. Shared packages are generic: they import only other shared packages and hold no plugin's domain.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/data/enums
