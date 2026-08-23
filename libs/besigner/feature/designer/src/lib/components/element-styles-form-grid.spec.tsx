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
// The panel's BoxStyler reads `palette.surface`, which only the editor's
// own theme carries — a bare `createTheme()` renders the panel not at all.
import { consoleThemeCssVar, ThemeProvider } from '@aglyn/shared-ui-theme'
import { act, fireEvent, render, screen } from '@testing-library/react'

import ElementStylesForm from './element-styles-form.component'

/**
 * One layout section, with nothing dropped (AGL-2486).
 *
 * The panel answered "how do I lay this out?" in two places. `Flexbox &
 * Grids` held the alignment toggles and the gaps; `Grid & Flex Child`,
 * four sections further down, held the track lists, the item placement and
 * the flex-child sizing. Both were about the same two CSS layout models,
 * neither was complete, and the split did not even follow the names: `Align
 * self` is a per-ITEM property and sat with the container controls, while
 * `Grid Columns` is a CONTAINER property and sat under "Flex Child".
 *
 * A consolidation is only worth anything if it loses nothing, so the
 * inventory below is written out as a literal — the twenty properties the
 * two sections carried between them, at the commit before this one. It is
 * the "before" list; the panel has to render all twenty in one section,
 * and no second section may reappear.
 */
const CONTAINER_TOGGLES = [
  'Flex direction',
  'Flex wrap',
  'Justify content',
  'Align items',
  'Align content',
  'Justify items',
  // Per-item, but still icon-button groups — the richer control is kept.
  'Align self',
  'Justify self',
]

/** Everything the two sections held as a typed field. */
const TYPED_FIELDS = [
  // ex Flexbox & Grids
  'Gap',
  'Row Gap',
  'Column Gap',
  // ex Grid & Flex Child
  'Grid Columns',
  'Grid Rows',
  'Grid Auto Flow',
  'Grid Column',
  'Grid Row',
  'Flex Grow',
  'Flex Shrink',
  'Flex Basis',
  'Order',
]

describe('styles panel layout section (AGL-2486)', () => {
  const seedNode = () => {
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes({
      root: { $id: 'root', componentId: 'muiStack', nodes: ['meta'] },
      meta: { $id: 'meta', componentId: 'muiStack', parentId: 'root' },
    } as any)
    return Aglyn.canvas.getNode('meta') as Aglyn.NodeSchema
  }

  const renderPanel = async () => {
    render(
      <ThemeProvider theme={consoleThemeCssVar}>
        <ElementStylesForm node={seedNode()} />
      </ThemeProvider>,
    )
    act(() => {
      fireEvent.click(screen.getByText('Flexbox & Grid'))
    })
    // The field editors are code-split (next/dynamic).
    await act(async () => undefined)
  }

  afterEach(() => Aglyn.canvas.reset())

  it('is the only layout section left', async () => {
    await renderPanel()
    expect(screen.queryByText('Grid & Flex Child')).toBeNull()
    // …and not by renaming the old one: the plural title is gone too.
    expect(screen.queryByText('Flexbox & Grids')).toBeNull()
    expect(screen.getByText('Flexbox & Grid')).toBeTruthy()
  })

  it('renders every property the two sections carried', async () => {
    await renderPanel()
    const section = screen
      .getByText('Flexbox & Grid')
      .closest('.MuiAccordion-root') as HTMLElement
    expect(section).toBeTruthy()

    for (const label of CONTAINER_TOGGLES) {
      // The toggles keep their icon-button groups rather than becoming
      // free text — the richer control per property is the one that stays.
      const control = screen
        .getByText(label)
        .closest('.MuiFormControl-root') as HTMLElement
      expect([label, section.contains(control)]).toEqual([label, true])
      expect([
        label,
        control.querySelectorAll('.MuiToggleButton-root').length > 0,
      ]).toEqual([label, true])
    }

    for (const label of TYPED_FIELDS) {
      const field = screen.getByLabelText(label)
      expect([label, section.contains(field)]).toEqual([label, true])
    }
  })

  it('counts out to the same twenty properties, before and after', async () => {
    // The arithmetic, said once: eight toggles plus twelve typed fields is
    // the eleven the container section had plus the nine the child section
    // had.
    expect(CONTAINER_TOGGLES.length + TYPED_FIELDS.length).toBe(20)
    expect(11 + 9).toBe(20)
    await renderPanel()
    for (const label of [...CONTAINER_TOGGLES, ...TYPED_FIELDS]) {
      expect([label, Boolean(screen.getAllByText(label).length)]).toEqual([
        label,
        true,
      ])
    }
  })
})
