/**
 * @jest-environment jsdom
 */
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

import {
  clearStyles,
  copyStyles,
  getStyleLabel,
  hasStyles,
  pasteStyles,
  STYLE_CLIPBOARD_FORMAT_VERSION,
  STYLE_CLIPBOARD_STORAGE_KEY,
} from './style-clipboard'

const node = (sx: unknown, label = 'Heading') =>
  ({ sx, labelShort: label }) as never

beforeEach(() => {
  clearStyles()
  window.localStorage.clear()
})

describe('style clipboard (AGL-1480)', () => {
  it('copies a look and pastes it onto another element', () => {
    expect(hasStyles()).toBe(false)
    copyStyles(node({ color: 'red', fontSize: 24 }))
    expect(hasStyles()).toBe(true)
    expect(getStyleLabel()).toBe('Heading')

    const target = node({ color: 'blue' }, 'Body')
    expect(pasteStyles(target)).toBe(true)
    expect((target as { sx: unknown }).sx).toEqual({
      color: 'red',
      fontSize: 24,
    })
  })

  /**
   * Merging would make the result depend on what the target already had, so
   * one look pasted onto two elements could produce two different ones.
   */
  it('REPLACES rather than merging', () => {
    copyStyles(node({ color: 'red' }))
    const target = node({ fontSize: 99, margin: 4 }, 'Body')
    pasteStyles(target)
    expect((target as { sx: unknown }).sx).toEqual({ color: 'red' })
  })

  it('carries the whole object, slices and all', () => {
    const rich = {
      color: 'red',
      sm: { color: 'blue' },
      '@scheme dark': { color: 'white' },
      '&:hover': { color: 'green' },
    }
    copyStyles(node(rich))
    const target = node(undefined, 'Body')
    pasteStyles(target)
    expect((target as { sx: unknown }).sx).toEqual(rich)
  })

  /**
   * A copy that tracks later edits to its source is not a copy, and two
   * targets pasted from one entry must not share an object.
   */
  it('detaches from the source and from every target', () => {
    const source = node({ color: 'red' })
    copyStyles(source)
    ;(source as { sx: Record<string, unknown> }).sx['color'] = 'green'

    const a = node(undefined, 'A')
    const b = node(undefined, 'B')
    pasteStyles(a)
    pasteStyles(b)
    expect((a as { sx: Record<string, unknown> }).sx['color']).toBe('red')
    ;(a as { sx: Record<string, unknown> }).sx['color'] = 'purple'
    expect((b as { sx: Record<string, unknown> }).sx['color']).toBe('red')
  })

  it('copying an unstyled element is a real copy that clears its target', () => {
    copyStyles(node(undefined))
    expect(hasStyles()).toBe(true)
    const target = node({ color: 'blue' }, 'Body')
    expect(pasteStyles(target)).toBe(true)
    expect((target as { sx: unknown }).sx).toBeUndefined()
  })

  it('refuses politely when there is nothing to do', () => {
    expect(copyStyles(undefined)).toBe(false)
    expect(pasteStyles(node({ color: 'red' }))).toBe(false)
    copyStyles(node({ color: 'red' }))
    expect(pasteStyles(undefined)).toBe(false)
  })

  it('mirrors to localStorage so a look survives the trip to another document', () => {
    copyStyles(node({ color: 'red' }))
    const raw = window.localStorage.getItem(STYLE_CLIPBOARD_STORAGE_KEY)
    expect(JSON.parse(String(raw))).toEqual({
      version: STYLE_CLIPBOARD_FORMAT_VERSION,
      label: 'Heading',
      sx: { color: 'red' },
    })
  })

  it('drops a mirrored entry written by an older build', () => {
    window.localStorage.setItem(
      STYLE_CLIPBOARD_STORAGE_KEY,
      JSON.stringify({ version: 0, label: 'old', sx: { color: 'red' } }),
    )
    clearStyles()
    window.localStorage.setItem(
      STYLE_CLIPBOARD_STORAGE_KEY,
      JSON.stringify({ version: 0, label: 'old', sx: { color: 'red' } }),
    )
    // `clearStyles` marks the module hydrated, so force a fresh read the way
    // a page load does.
    jest.resetModules()
    return import('./style-clipboard').then((fresh) => {
      expect(fresh.hasStyles()).toBe(false)
    })
  })
})
