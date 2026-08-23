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

import { unstable_styleFunctionSx as styleFunctionSx } from '@mui/system'
import { createTheme } from '@mui/material/styles'

import { buildStyleFieldGroups } from './style-field-groups'
import {
  buildFontSizeScaleOptions,
  buildFontWeightScaleOptions,
  buildStyleThemeScales,
  buildZIndexScaleOptions,
} from './theme-scale-options'

/**
 * Theme scales for font size, font weight and z-index (AGL-2486, item 12).
 *
 * The load-bearing claim is not that the panel shows a list — it is that the
 * value the panel STORES is a theme token path MUI resolves itself, so the
 * element keeps following the theme. That claim is only worth anything if it
 * is checked against MUI's own sx pipeline rather than restated, so these
 * tests run the stored values through `styleFunctionSx`.
 */
const theme = createTheme()
const scales = buildStyleThemeScales(theme as any)

/** What MUI actually emits for an sx holding one of these values. */
const resolve = (sx: Record<string, unknown>) =>
  styleFunctionSx({ theme, sx }) as Record<string, unknown>

describe('theme scales for the styles panel (AGL-2486)', () => {
  it('stores a token path that MUI resolves against the theme', () => {
    expect(resolve({ fontSize: 'h4.fontSize' }).fontSize).toBe(
      theme.typography.h4.fontSize,
    )
    expect(resolve({ fontWeight: 'fontWeightBold' }).fontWeight).toBe(
      theme.typography.fontWeightBold,
    )
    expect(resolve({ zIndex: 'appBar' }).zIndex).toBe(theme.zIndex.appBar)
  })

  it('still passes a raw value straight through', () => {
    // Arbitrary values are legitimate: the scale is an offer, not a gate.
    expect(resolve({ fontSize: '18px' }).fontSize).toBe('18px')
    expect(resolve({ fontWeight: '700' }).fontWeight).toBe('700')
    expect(resolve({ zIndex: 1400 }).zIndex).toBe(1400)
  })

  it('offers every option as a value the theme really resolves', () => {
    // The guard against a stale hardcoded list: an option whose token the
    // theme does not define would come back as its own path string.
    for (const option of scales.fontSize) {
      expect(resolve({ fontSize: option.value }).fontSize).not.toBe(
        option.value,
      )
    }
    for (const option of scales.zIndex) {
      expect(resolve({ zIndex: option.value }).zIndex).toBe(
        theme.zIndex[option.value as keyof typeof theme.zIndex],
      )
    }
  })

  it('names what each token resolves to, which is what makes it legible', () => {
    const h4 = scales.fontSize.find((option) => option.value === 'h4.fontSize')
    expect(h4?.label).toBe('Heading 4')
    expect(h4?.hint).toBe(`${theme.typography.h4.fontSize}`)
    const appBar = scales.zIndex.find((option) => option.value === 'appBar')
    expect(appBar?.label).toBe('App bar')
    expect(appBar?.hint).toBe(`${theme.zIndex.appBar}`)
  })

  it('orders the stacking layers by the layer they sit on', () => {
    const values = scales.zIndex.map(
      (option) => theme.zIndex[option.value as keyof typeof theme.zIndex],
    )
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })

  it('offers the theme weights AND the plain CSS ladder', () => {
    const values = scales.fontWeight.map((option) => option.value)
    expect(values).toContain('fontWeightBold')
    expect(values).toContain('700')
    // The theme-following answer comes first.
    expect(values.indexOf('fontWeightBold')).toBeLessThan(
      values.indexOf('700'),
    )
  })

  it('offers nothing rather than guessing when there is no theme', () => {
    // A spec or a theme still loading must not produce a list of tokens the
    // host does not define — that would be a scale that resolves to nothing.
    expect(buildFontSizeScaleOptions(undefined)).toEqual([])
    expect(buildZIndexScaleOptions(undefined)).toEqual([])
    expect(buildFontWeightScaleOptions(undefined).every((option) =>
      /^[0-9]+$/.test(option.value),
    )).toBe(true)
    expect(buildFontSizeScaleOptions({ typography: {} })).toEqual([])
  })

  it('reaches the panel fields, not just the builder', () => {
    // Where this actually has to land: the three fields Zach named.
    const fields = buildStyleFieldGroups(['#123456']).flatMap(
      (group) => group.fields,
    )
    const field = (name: string) =>
      fields.find((entry) => entry.name === name) as Record<string, any>
    const withScales = buildStyleFieldGroups(['#123456'], {
      themeScales: scales,
    }).flatMap((group) => group.fields)
    const scaled = (name: string) =>
      withScales.find((entry) => entry.name === name) as Record<string, any>

    expect(scaled('fontSize')['scaleOptions']).toBe(scales.fontSize)
    expect(scaled('fontWeight')['scaleOptions']).toBe(scales.fontWeight)
    expect(scaled('zIndex')['scaleOptions']).toBe(scales.zIndex)
    // Without a theme the same fields are still there and still take a raw
    // value — the negative control for "the scale is an offer".
    expect(field('fontWeight')['scaleOptions']).toEqual([])
    expect(field('zIndex')['scaleOptions']).toEqual([])
  })
})
