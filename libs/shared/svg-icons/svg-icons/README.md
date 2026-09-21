# @aglyn/shared-svg-icons

React components for the flexbox and grid alignment icons used in the Besigner style panel: one icon for each value of `align-content`, `align-items`, `align-self`, `justify-content`, `justify-items`, and for flex direction and wrapping. Install it if you are building a layout control and want these glyphs; otherwise it arrives as a dependency of `@aglyn/besigner-ui`.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-svg-icons@beta

Peer dependency: `react`. The bundle imports `react/jsx-runtime` and leaves React external.

## What's in it

Each export is a React component produced from an SVG file by SVGR. It renders an inline `<svg>` drawn on a 13 by 13 viewBox, filled with `currentColor`, and passes its props through to the `<svg>` element. Names follow the CSS property and value, in camel case with an `Icon` suffix:

- `alignContent…Icon`: `Center`, `End`, `SpaceAround`, `SpaceBetween`, `SpaceEvenly`, `Start`, `Stretch`
- `alignItems…Icon`: `Center`, `FlexEnd`, `FlexStart`, `Stretch`
- `alignSelf…Icon`: `Center`, `FlexEnd`, `FlexStart`, `Stretch`
- `justifyContent…Icon`: `Center`, `FlexEnd`, `FlexStart`, `SpaceAround`, `SpaceBetween`, `SpaceEvenly`
- `justifyItems…Icon`: `Center`, `End`, `Start`, `Stretch`
- `flexDirectionIcon`, `flexNowrapIcon`, `flexWrapIcon`

Note that the export names start with a lowercase letter, so alias one to a capitalized name before using it as a JSX tag.

This package is a Vite library build, unlike most `@aglyn/*` packages. The root entry is a single bundle, published as ES module (`index.mjs`) and CommonJS (`index.js`). Import from the package root only.

## Usage

```tsx
import { alignItemsCenterIcon as AlignItemsCenterIcon } from '@aglyn/shared-svg-icons'

export function Example() {
  return <AlignItemsCenterIcon width={16} height={16} />
}
```

With Material UI, pass one as the `component` of an `SvgIcon`:

```tsx
import { flexWrapIcon } from '@aglyn/shared-svg-icons'
import { SvgIcon } from '@mui/material'

const icon = <SvgIcon component={flexWrapIcon} viewBox="0 0 13 13" />
```

## How it fits

A `shared` UI package with no `@aglyn/*` dependencies. `@aglyn/besigner-ui` uses it in its element style form. Shared packages are generic: they import only other shared packages and hold no plugin's domain.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/svg-icons/svg-icons
