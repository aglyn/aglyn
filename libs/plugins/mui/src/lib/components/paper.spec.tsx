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

/**
 * AGL-1451: the Variant select offered `{ value: '', label: 'Elevation
 * (default)' }` and this element passed everything else straight into MUI
 * with no cleared-prop guard. `''`/`null` satisfies neither branch — not
 * `undefined`, so a destructuring default never fires, and falsy, so an
 * explicit branch is skipped — and the option could not survive a save at
 * all (AGL-1191).
 */
const paperRoot = (ui: React.ReactElement): HTMLElement => {
  const { container } = render(ui)
  return container.querySelector('.MuiPaper-root') as HTMLElement
}

describe('Paper drops cleared props before MUI sees them (AGL-1451)', () => {
  it('a cleared variant renders exactly as an absent one', () => {
    const absent = paperRoot(<PaperElement />).className
    expect(paperRoot(<PaperElement variant={null as any} />).className).toBe(
      absent,
    )
    expect(paperRoot(<PaperElement variant={'' as any} />).className).toBe(
      absent,
    )
  })

  it('and that render is MUI’s own default: an elevated, rounded surface', () => {
    const root = paperRoot(<PaperElement variant={null as any} />)
    expect(root.className).toMatch(/MuiPaper-elevation/)
    expect(root.className).toMatch(/MuiPaper-rounded/)
    expect(root.className).not.toMatch(/MuiPaper-outlined/)
  })

  it('a cleared boolean does not reach MUI as a value', () => {
    // `square={null}` is the AGL-1226 shape on a switch attribute.
    expect(paperRoot(<PaperElement square={null as any} />).className).toBe(
      paperRoot(<PaperElement />).className,
    )
  })

  // ---- positive controls: the guard must not shred real values ----

  it('keeps `elevation={0}` — a deliberately flat surface', () => {
    // The falsy value an author can mean, and the one a careless guard
    // would eat: 0 is a real shadow depth, not a cleared field.
    expect(paperRoot(<PaperElement elevation={0} />).className).toMatch(
      /MuiPaper-elevation0/,
    )
  })

  it('keeps `square` when it is really set', () => {
    expect(paperRoot(<PaperElement square />).className).not.toMatch(
      /MuiPaper-rounded/,
    )
  })

  it('keeps an explicit outlined variant', () => {
    expect(paperRoot(<PaperElement variant="outlined" />).className).toMatch(
      /MuiPaper-outlined/,
    )
  })
})

describe('Paper "Variant" options (AGL-1451)', () => {
  const field = schema.attributes.find((a: any) => a.name === 'variant') as any

  it('never offers a value the attributes form cannot persist', () => {
    for (const option of field.options) {
      expect(option.value).not.toBe('')
      expect(option.value).not.toBeNull()
      expect(option.value).not.toBeUndefined()
    }
  })

  it('spells the default as MUI’s own value rather than deleting it', () => {
    // Unlike Container's "Default", `elevation` is a real MUI variant and
    // the other half of a two-way choice, so it stays — as a sentinel.
    expect(field.options.map((o: any) => o.value)).toEqual([
      'elevation',
      'outlined',
    ])
  })
})
