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
import {
  buildToolbarMixin,
  getSchemeColor,
  orderSensitiveKey,
  readToolbarHeight,
  SURFACE_COLOR_FIELDS,
  TINT_COLOR_FIELDS,
  TOOLBAR_LANDSCAPE_QUERY,
  TOOLBAR_SM_QUERY,
} from './theme-editor.constants'

describe('buildToolbarMixin (AGL-1242)', () => {
  it('emits the landscape clause BEFORE the sm height', () => {
    // Load-bearing: these land in one CSS rule, so the last matching
    // declaration wins. Landscape last makes every desktop — a wide
    // LANDSCAPE window — take the 48px branch.
    const keys = Object.keys(buildToolbarMixin(56, 72))
    expect(keys).toEqual(['minHeight', TOOLBAR_LANDSCAPE_QUERY, TOOLBAR_SM_QUERY])
    expect(keys.indexOf(TOOLBAR_LANDSCAPE_QUERY)).toBeLessThan(
      keys.indexOf(TOOLBAR_SM_QUERY),
    )
  })

  it('is always complete, falling back to MUI defaults', () => {
    // `mixins.toolbar` REPLACES MUI's default, so a partial object drops the
    // breakpoints it omits — setting only a desktop height left portrait
    // phones with no min-height at all.
    expect(buildToolbarMixin(undefined, 72)).toEqual({
      minHeight: '56px',
      [TOOLBAR_LANDSCAPE_QUERY]: {
        '@media (orientation: landscape)': { minHeight: 48 },
      },
      [TOOLBAR_SM_QUERY]: { minHeight: '72px' },
    })
    expect(buildToolbarMixin(64, undefined)[TOOLBAR_SM_QUERY]).toEqual({
      minHeight: '64px',
    })
  })

  it('round-trips through readToolbarHeight', () => {
    const theme: HostTheme = { mixins: { toolbar: buildToolbarMixin(56, 72) } }
    expect(readToolbarHeight(theme, 'xs')).toBe(56)
    expect(readToolbarHeight(theme, 'sm')).toBe(72)
    expect(readToolbarHeight({}, 'xs')).toBeUndefined()
  })
})

describe('orderSensitiveKey (AGL-1242)', () => {
  it('distinguishes two mixins that differ ONLY by key order', () => {
    // The whole point: `deepEqual` calls these equal, so the Save button
    // stayed disabled on a change that really does alter the rendered CSS.
    const good: HostTheme = { mixins: { toolbar: buildToolbarMixin(56, 72) } }
    const bad: HostTheme = {
      mixins: {
        toolbar: {
          minHeight: '56px',
          [TOOLBAR_SM_QUERY]: { minHeight: '72px' },
          [TOOLBAR_LANDSCAPE_QUERY]: {
            '@media (orientation: landscape)': { minHeight: 48 },
          },
        },
      },
    }
    expect(orderSensitiveKey(good)).not.toBe(orderSensitiveKey(bad))
  })

  it('treats identical mixins as identical', () => {
    const a: HostTheme = { mixins: { toolbar: buildToolbarMixin(56, 72) } }
    const b: HostTheme = { mixins: { toolbar: buildToolbarMixin(56, 72) } }
    expect(orderSensitiveKey(a)).toBe(orderSensitiveKey(b))
    expect(orderSensitiveKey({})).toBe(orderSensitiveKey({ spacing: 8 }))
  })
})

describe('TINT_COLOR_FIELDS (AGL-1244)', () => {
  // Tints ride `SurfaceColorPath` rather than `PALETTE_COLOR_FIELDS` because
  // the palette fields all write `{ main: hex }` and a tint has no `main`.
  // This pins that the shared path machinery reads and writes the group the
  // converter actually looks for.
  it('round-trips through the shared surface-path accessors', () => {
    const theme: HostTheme = {
      colorSchemes: { light: { tint: { primary: '#E6F5FF' } } },
    }
    const colors = theme.colorSchemes?.light
    expect(getSchemeColor(colors, ['tint', 'primary'])).toBe('#E6F5FF')
    expect(getSchemeColor(colors, ['tint', 'secondary'])).toBeUndefined()
    expect(getSchemeColor(undefined, ['tint', 'primary'])).toBeUndefined()
  })

  it('offers all three tints and stays disjoint from the surface fields', () => {
    expect(TINT_COLOR_FIELDS.map(({ path }) => path.join('.'))).toEqual([
      'tint.primary',
      'tint.secondary',
      'tint.tertiary',
    ])
    const surfacePaths = SURFACE_COLOR_FIELDS.map(({ path }) => path.join('.'))
    for (const { path } of TINT_COLOR_FIELDS) {
      expect(surfacePaths).not.toContain(path.join('.'))
    }
  })
})
