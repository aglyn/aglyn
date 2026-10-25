/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Theme } from '../../vendor/mui'

/**
 * The palette groups a `color="<group>.<key>"` may name: every string leaf
 * of each, read from the theme itself so a custom color (tertiary, surface)
 * is covered the moment it exists.
 */
const PALETTE_PATH_GROUPS = [
  'text',
  'primary',
  'secondary',
  'tertiary',
  'surface',
  'error',
  'warning',
  'info',
  'success',
  'grey',
  'common',
  'background',
  'action',
] as const

/** Every `<group>.<key>` path whose value in this palette is a color string. */
export function palettePathColors(palette: Theme['palette']): string[] {
  const groups = palette as unknown as Record<string, Record<string, unknown> | undefined>
  return PALETTE_PATH_GROUPS.flatMap((group) =>
    Object.entries(groups[group] ?? {})
      .filter(([, value]) => typeof value === 'string')
      .map(([key]) => `${group}.${key}`),
  )
}

/** A palette path's value, from the CSS variables where the theme has them. */
function readPalettePath(theme: Theme, path: string): string | undefined {
  const [group, key] = path.split('.')
  const palette = (theme.vars?.palette ?? theme.palette) as unknown as Record<string, Record<string, unknown> | undefined>
  const value = palette[group]?.[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * `<Typography color="text.secondary">`, and every other palette path, painted
 * again. MUI 9's Typography no longer runs system props: its `color` matches
 * only a palette name (`primary`) or `textPrimary`/`textSecondary`/
 * `textDisabled`, and a path such as `text.secondary` is dropped, so the text
 * takes its parent's color. Close to 2,500 places across the console and
 * sites were written that way when MUI 6 read the path as a palette lookup;
 * each path becomes a theme variant here instead, the one place every theme
 * passes through. Variants the options already give MuiTypography come first,
 * and a path one of them names is left to it.
 */
export function addPalettePathColorVariants(theme: Theme): void {
  const components = (theme.components ??= {})
  const typography = (components.MuiTypography ??= {})
  const variants = [...(typography.variants ?? [])]
  const named = new Set(
    variants.map((variant) => (typeof variant.props === 'object' ? (variant.props as { color?: unknown }).color : undefined)),
  )
  for (const path of palettePathColors(theme.palette)) {
    if (named.has(path)) continue
    variants.push({
      // The path is not one of Typography's declared colors, which is the
      // whole point: the type names the declared ones only.
      props: { color: path as never },
      // MUI hands a variant's style its own base theme type; the theme is ours.
      style: ({ theme: current }) => ({ color: readPalettePath(current as unknown as Theme, path) }),
    })
  }
  typography.variants = variants
}
