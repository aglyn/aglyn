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

import { listConsoleThemePresets } from '@aglyn/aglyn'
import { validateThemeForPublish } from '@aglyn/aglyn/app-utils/marketplace-theme'
import {
  createResponsiveTheme,
  hostThemeToThemeOptions,
  mergeThemeOptions,
  sanitizeHostTheme,
  siteBaseOptions,
} from '@aglyn/shared-ui-theme'
import { registerThemesConsole } from '../plugin'
import { THEME_PRESETS } from '.'

/** A palette path an `sx` value names — which must never reach CSS unresolved. */
const PALETTE_PATH =
  /^(primary|secondary|tertiary|surface|error|warning|info|success|background|text|tint|divider|action|grey)(\.[a-zA-Z0-9]+)*$/

/** Every string leaf of a style, with its path. */
function leaves(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]]
  if (Array.isArray(value)) return value.flatMap((entry, index) => leaves(entry, `${path}[${index}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => leaves(entry, `${path}.${key}`))
  }
  return []
}

/** A slot's styles resolved the way MUI resolves them: functions called, lists flattened. */
function resolveStyle(style: unknown, props: Record<string, unknown>): unknown[] {
  if (typeof style === 'function') return resolveStyle(style(props), props)
  if (Array.isArray(style)) return style.flatMap((entry) => resolveStyle(entry, props))
  return [style]
}

describe.each(THEME_PRESETS.map((preset) => [preset.name, preset] as const))(
  'the %s built-in theme (AGL-3405)',
  (_, preset) => {
    it('is a complete, readable theme by the publish validator', () => {
      const verdict = validateThemeForPublish(preset.theme)
      expect(verdict.errors).toEqual([])
      expect(verdict.warnings).toEqual([])
    })

    it('sets the platform text styles and a tertiary accent in both schemes (AGL-3411)', () => {
      // Left out, a platform style keeps the platform's own font and weights,
      // so it reads as a different design dropped into this one.
      for (const variant of ['displayXl', 'lede', 'bodyCompact', 'micro'] as const) {
        expect([variant, preset.theme.typography?.variants?.[variant]?.fontSize]).toEqual([
          variant,
          expect.any(String),
        ])
      }
      for (const scheme of ['light', 'dark'] as const) {
        expect([scheme, preset.theme.colorSchemes?.[scheme]?.tertiary?.main]).toEqual([
          scheme,
          expect.any(String),
        ])
      }
    })

    it('styles only components a theme may style', () => {
      expect(Object.keys(sanitizeHostTheme(preset.theme).components ?? {}).sort()).toEqual(
        Object.keys(preset.theme.components ?? {}).sort(),
      )
    })

    it.each(['light', 'dark'] as const)(
      'resolves every component style against the %s theme it renders under',
      (scheme) => {
        const theme = createResponsiveTheme({
          themeOptions: mergeThemeOptions(
            siteBaseOptions(undefined, scheme),
            hostThemeToThemeOptions(preset.theme, scheme),
          ),
        })
        const unresolved: string[] = []
        for (const name of Object.keys(preset.theme.components ?? {})) {
          const component = (theme.components as Record<string, any>)[name]
          const props = { theme, ownerState: {} }
          const styles = [
            ...Object.values(component?.styleOverrides ?? {}).flatMap((slot) =>
              resolveStyle(slot, props),
            ),
            ...(component?.variants ?? []).flatMap((variant: { style: unknown }) =>
              resolveStyle(variant.style, props),
            ),
          ]
          for (const [path, value] of leaves(styles)) {
            if (PALETTE_PATH.test(value)) unresolved.push(`${name}${path} = ${value}`)
          }
        }
        expect(unresolved).toEqual([])
      },
    )
  },
)

describe('the Themes plugin (AGL-3405)', () => {
  it('contributes every built-in theme under an id of its own', () => {
    registerThemesConsole()
    const listed = listConsoleThemePresets(['theme-presets'])
    expect(listed.map((preset) => preset.id)).toEqual([
      'theme-presets.bootstrap',
      'theme-presets.minimal',
      'theme-presets.material3',
      'theme-presets.ant-design',
      'theme-presets.fluent',
      'theme-presets.carbon',
      'theme-presets.cupertino',
    ])
    expect(new Set(listed.map((preset) => preset.pluginId))).toEqual(new Set(['theme-presets']))
    // Off for a site, it contributes nothing.
    expect(listConsoleThemePresets([])).toEqual([])
  })
})
