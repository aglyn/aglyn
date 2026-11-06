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

import * as Aglyn from '@aglyn/aglyn'
import { render, screen } from '@testing-library/react'
import DataTable, { dataTablePresets, dataTableSchema } from './data-table'

const MATRIX = [
  'Feature | Us | Them',
  '--- | :---: | ---:',
  'Open source | Yes | No',
  'Self-hostable | Yes | No',
].join('\n')

describe('the Table element (AGL-2543)', () => {
  it('renders a real HTML table, not a pre-formatted block', () => {
    // The Markdown workaround produced a real `<table>` too — anything less
    // here would be a regression on the thing it replaces.
    render(<DataTable rows={MATRIX} />)
    const table = document.querySelector('table')
    expect(table).toBeTruthy()
    expect(table?.querySelectorAll('thead th')).toHaveLength(3)
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(2)
  })

  it('drops the divider instead of rendering a row of dashes', () => {
    render(<DataTable rows={MATRIX} />)
    expect(screen.queryByText('---')).toBeNull()
    expect(screen.getByText('Open source')).toBeTruthy()
  })

  it('honours the alignment the divider encodes', () => {
    // Asserting the rendered EFFECT, not the prop: MUI turns `align` into a
    // class and a `text-align` rule, and never emits an `align` attribute —
    // so checking for the attribute would measure the adjacent quantity and
    // pass or fail for reasons unrelated to what the reader sees.
    render(<DataTable rows={MATRIX} />)
    const headers = [...document.querySelectorAll('thead th')]
    expect(
      headers.map((cell) => getComputedStyle(cell).textAlign),
    ).toEqual(['left', 'center', 'right'])
  })

  it('turns the first row into data when the header is switched off', () => {
    render(<DataTable rows={MATRIX} headerRow={false} />)
    expect(document.querySelector('thead')).toBeNull()
    expect(document.querySelectorAll('tbody tr')).toHaveLength(3)
  })

  it('puts the grid in a scroll box of its own', () => {
    // Half of what a wide matrix on a phone needs; the other half is the
    // table's own sizing, and the pair is specced in `table-scroll.spec.tsx`
    // against the Markdown route as well. This element shipped with only
    // this half, which is why it crushed its columns instead (AGL-2568).
    const { container } = render(<DataTable rows={MATRIX} />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(getComputedStyle(wrapper).overflowX).toBe('auto')
  })

  it('says what to do when it is empty rather than rendering nothing', () => {
    // An empty element that renders nothing is invisible on the canvas, and
    // an author cannot select what they cannot see.
    render(
      <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
        <DataTable rows="" />
      </Aglyn.ScreenLinkContext.Provider>,
    )
    expect(screen.getByText(/right-click it to start a table/i)).toBeTruthy()
    expect(document.querySelector('table')).toBeNull()
  })

  it('renders nothing on a published page when it is empty (AGL-3067)', () => {
    // A visitor has no Attributes panel. The published page is the surface
    // with no editing flag, which is how the tenant renders.
    const { container } = render(
      <DataTable rows="" data-aglyn="leaf:matrix" />,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('data-aglyn')).toBe('leaf:matrix')
    expect(container.textContent).toBe('')
    expect(getComputedStyle(root).borderStyle).not.toContain('dashed')
  })

  it('exposes the grid through the DATA_TABLE editor, not a text box', () => {
    // The issue's actual complaint is that changing one cell means editing
    // pipe syntax. Shipping this element with a plain textarea would
    // re-ship that complaint, so the field type is part of the fix.
    const rowsAttribute = dataTableSchema.attributes?.find(
      (attribute) => attribute.name === 'rows',
    )
    expect(rowsAttribute?.component).toBe('data-table')
  })

  it('draws a cell formatted on the canvas as formatting (AGL-4203)', () => {
    render(
      <DataTable
        rows={[
          'Feature | Us',
          'Docs | <b>Yes</b>, <a href="https://example.test/docs">see docs</a>',
          'Plain | a < b',
        ].join('\n')}
      />,
    )
    const bold = document.querySelector('tbody b')
    expect(bold?.textContent).toBe('Yes')
    const link = document.querySelector('tbody a')
    expect(link?.getAttribute('href')).toBe('https://example.test/docs')
    // A plain cell is still text: its `<` is a character, not a tag.
    expect(screen.getByText('a < b')).toBeTruthy()
  })

  it('never draws script a formatted cell was given (AGL-4203)', () => {
    // A document can be written without the editor, so the renderer
    // sanitizes on every render rather than trusting what was stored.
    render(
      <DataTable
        rows={'A | B\n<img src=x onerror="alert(1)"><script>alert(1)</script>ok | <a href="javascript:alert(1)">x</a>'}
      />,
    )
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('[onerror]')).toBeNull()
    expect(document.querySelector('a[href^="javascript"]')).toBeNull()
  })

  it('ships a preset that already shows what the element is for', () => {
    const preset = dataTablePresets[0]
    const rows = String((preset.data as any).props.rows)
    expect(rows).toContain('Feature')
    // An emphasised column out of the box: the "ours" column is the entire
    // point of a comparison table, and it is the affordance an author is
    // least likely to discover on their own.
    expect((preset.data as any).props.emphasizeColumn).toBe(2)
  })
})
