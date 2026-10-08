/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  applyThemeEditorEdits,
  readThemeEditorEdits,
  readThemeEditorValues,
} from './theme-editor-edits'
import { SYSTEM_FONT_VALUE, writeThemeColor, writeToolbarHeight } from './theme-editor-fields'

describe('theme editor edits', () => {
  it('applies each control with the editor\'s own writer', () => {
    const base = { colorSchemes: { light: { primary: { main: '#111111', dark: '#000000' } } } }
    const edits = readThemeEditorEdits([
      { control: 'color', scheme: 'light', token: 'primary', value: '#1a73e8' },
      { control: 'color', scheme: 'dark', token: 'background.default', value: '#121212' },
      { control: 'borderRadius', value: 12 },
      { control: 'spacing', value: '6' },
      { control: 'darkScheme', value: 'off' },
      { control: 'fontFamily', value: 'Inter' },
      { control: 'navHeight', breakpoint: 'sm', value: 72 },
    ])
    if (typeof edits === 'string') throw new Error(edits)
    const next = applyThemeEditorEdits(base as never, edits)
    // A palette color writes `main` and keeps the rest of its record.
    expect(next.colorSchemes?.light?.primary).toEqual({ main: '#1a73e8', dark: '#000000' })
    expect(next).toEqual(
      expect.objectContaining({ shape: { borderRadius: 12 }, spacing: 6, darkScheme: 'off' }),
    )
    expect(next.mixins).toEqual(writeToolbarHeight({}, 'sm', 72).mixins)
    const values = readThemeEditorValues(next)
    expect(values.colors.light['primary']).toBe('#1a73e8')
    expect(values.colors.dark['background.default']).toBe('#121212')
    expect(values.fontFamily).toBe('Inter')
    // The mixin is rebuilt whole, so the unset height reads as MUI's own.
    expect(values.navHeight).toEqual({ xs: 56, sm: 72 })
  })

  it('clears a control back to the theme\'s own with null', () => {
    const base = writeThemeColor({}, 'light', 'divider', '#cccccc')
    const edits = readThemeEditorEdits([
      { control: 'color', scheme: 'light', token: 'divider', value: null },
      { control: 'fontFamily', value: SYSTEM_FONT_VALUE },
    ])
    if (typeof edits === 'string') throw new Error(edits)
    const values = readThemeEditorValues(applyThemeEditorEdits(base, edits))
    expect(values.colors.light['divider']).toBeNull()
    expect(values.fontFamily).toBe(SYSTEM_FONT_VALUE)
  })

  it('refuses what the editor could not have sent', () => {
    expect(readThemeEditorEdits([])).toBe('Nothing to change.')
    expect(readThemeEditorEdits([{ control: 'color', scheme: 'light', token: 'primary', value: 'red' }])).toBe(
      'Use a hex color such as #1A73E8.',
    )
    expect(readThemeEditorEdits([{ control: 'color', scheme: 'light', token: 'nope', value: '#fff' }])).toBe(
      'That is not a theme color.',
    )
    expect(readThemeEditorEdits([{ control: 'borderRadius', value: 99 }])).toBe('Use a number from 0 to 24.')
    expect(readThemeEditorEdits([{ control: 'fontFamily', value: 'Comic Sans' }])).toBe('Pick a font from the list.')
    expect(readThemeEditorEdits([{ control: 'components', value: {} }])).toBe('That is not a theme control.')
  })
})
