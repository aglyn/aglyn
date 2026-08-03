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

import { render, screen } from '@testing-library/react'
import PaperElement, { MAX_ELEVATION, presets, schema, toElevation } from './paper'

describe('toElevation (AGL-1201)', () => {
  it('accepts the string a number field round-trips as', () => {
    // `elevation="3"` indexes MUI's shadow array with a string and gets
    // undefined back — the paper renders completely flat.
    expect(toElevation('3')).toBe(3)
    expect(toElevation(3)).toBe(3)
  })

  it('clamps to the shadow scale MUI actually has', () => {
    expect(toElevation(99)).toBe(MAX_ELEVATION)
    expect(toElevation(-5)).toBe(0)
  })

  it('treats blank and junk as unset, not as zero', () => {
    expect(toElevation('')).toBeUndefined()
    expect(toElevation(null)).toBeUndefined()
    expect(toElevation('deep')).toBeUndefined()
  })
})

describe('Paper element', () => {
  it('gives a string elevation a real shadow', () => {
    const { container } = render(
      <PaperElement elevation={'3' as any}>{'Panel'}</PaperElement>,
    )
    expect(screen.getByText('Panel')).toBeTruthy()
    expect(
      (container.querySelector('.MuiPaper-root') as HTMLElement).className,
    ).toMatch(/MuiPaper-elevation3/)
  })

  it('drops the elevation on the outlined variant', () => {
    // MUI's outlined variant has no shadow; passing both produces an
    // elevation class that contradicts the visible border.
    const { container } = render(
      <PaperElement variant="outlined" elevation={8}>
        {'Panel'}
      </PaperElement>,
    )
    const root = container.querySelector('.MuiPaper-root') as HTMLElement
    expect(root.className).toMatch(/MuiPaper-outlined/)
    expect(root.className).not.toMatch(/MuiPaper-elevation8/)
  })

  it('hides the elevation control where it does nothing', () => {
    const field = schema.attributes.find((a: any) => a.name === 'elevation')
    expect((field as any).condition).toEqual({
      when: 'variant',
      is: 'outlined',
      notMatch: true,
    })
  })

  it('ships presets with content, not an empty surface', () => {
    for (const preset of presets) {
      expect((preset.data as any).nodes.length).toBeGreaterThan(0)
    }
  })
})
