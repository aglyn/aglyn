# @aglyn/shared-ui-color-picker

A React color picker: a thin wrapper over `react-color`'s `SketchPicker` that keeps the picked color in local state and re-seeds it when the `color` prop changes. It is mainly a building block of the color field in `@aglyn/shared-ui-jsx-forms`.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-ui-color-picker@beta

Peer dependencies: `react` and `@mui/material`. `react-color` is a regular dependency and is installed with the package.

## What's in it

- `ColorPicker` and `ColorPickerProps` from the root entry. `ColorPickerProps` extends `SketchPickerProps` from `react-color` unchanged, so every `SketchPicker` prop applies (`color`, `onChange`, `onChangeComplete`, `presetColors`, `disableAlpha` and the rest). The component re-seeds its internal color whenever the `color` prop changes, and forwards its ref to the `SketchPicker`.
- Subpath modules, not re-exported from the root:
  - `@aglyn/shared-ui-color-picker/color-swatch` — `ColorSwatch`
  - `@aglyn/shared-ui-color-picker/color-grid` — `ColorGrid`
  - `@aglyn/shared-ui-color-picker/constants/material-palettes` — `materialPalettes`, the Material Design color palettes as data

## Usage

```tsx
import { ColorPicker } from '@aglyn/shared-ui-color-picker'
import { useState } from 'react'

export function Example() {
  const [color, setColor] = useState('#1976d2')
  return (
    <ColorPicker
      color={color}
      onChangeComplete={(result) => setColor(result.hex)}
    />
  )
}
```

## How it fits

A `shared` UI package. It depends on `@aglyn/shared-util-tools`, and `@aglyn/shared-ui-jsx-forms` builds its color form field on it. Shared packages are generic: they import only other shared packages and hold no plugin's domain.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/ui/color-picker
