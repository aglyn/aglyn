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

import type { HostTheme } from '@aglyn/shared-data-types'
import { siteBaseOptions } from '../tenant.theme'
import { createResponsiveTheme } from './create-responsive-theme'
import { hostThemeToThemeOptions, mergeThemeOptions } from './host-theme'
import { themePreviewKit } from './theme-preview-kit'

const THEME: HostTheme = {
  colorSchemes: {
    light: {
      primary: { main: '#18181b', contrastText: '#fafafa' },
      background: { default: '#ffffff', paper: '#fdfdfd' },
    },
    dark: {
      primary: { main: '#fafafa', contrastText: '#18181b' },
      background: { default: '#09090b', paper: '#111113' },
    },
  },
} as HostTheme

describe('themePreviewKit', () => {
  it('reads the colours off the theme the console preview renders under', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const built = createResponsiveTheme({
        themeOptions: mergeThemeOptions(siteBaseOptions(undefined, scheme), hostThemeToThemeOptions(THEME, scheme)),
      })
      const kit = themePreviewKit(THEME, scheme, undefined)
      expect(kit.scheme).toBe(scheme)
      expect(kit.primary.main).toBe(built.palette.primary.main)
      expect(kit.primary.contrastText).toBe(built.palette.primary.contrastText)
      expect(kit.secondary.main).toBe(built.palette.secondary.main)
      expect(kit.background).toEqual({
        default: built.palette.background.default,
        paper: built.palette.background.paper,
      })
      expect(kit.text.primary).toBe(built.palette.text.primary)
      expect(kit.divider).toBe(built.palette.divider)
      expect(kit.selected).toBe(built.palette.action.selected)
    }
    expect(themePreviewKit(THEME, 'light', undefined).primary.main).toBe('#18181b')
    expect(themePreviewKit(THEME, 'dark', undefined).background.default).toBe('#09090b')
  })

  it('fills what the theme leaves unset from the site base, as the site does', () => {
    const empty = themePreviewKit({} as HostTheme, 'light', undefined)
    const built = createResponsiveTheme({ themeOptions: siteBaseOptions(undefined, 'light') })
    expect(empty.primary.main).toBe(built.palette.primary.main)
    expect(empty.tertiary.main).toBe((built.palette as unknown as { tertiary: { main: string } }).tertiary.main)
    expect(empty.surface.main).not.toBe('')
    expect(empty.tint.primary).not.toBe('')
  })

  it('lists the whole type ramp, largest first, without inherit', () => {
    const ramp = themePreviewKit(THEME, 'light', undefined).typography
    expect(ramp.length).toBeGreaterThan(8)
    expect(ramp.map((rung) => rung.key)).not.toContain('inherit')
    expect(ramp.map((rung) => rung.key)).toEqual(expect.arrayContaining(['h1', 'body1', 'caption']))
    for (let i = 1; i < ramp.length; i++) expect(ramp[i - 1].sizePx).toBeGreaterThanOrEqual(ramp[i].sizePx)
    const h1 = ramp.find((rung) => rung.key === 'h1')
    const body = ramp.find((rung) => rung.key === 'body1')
    expect(h1 && body && h1.sizePx > body.sizePx).toBe(true)
  })
})
