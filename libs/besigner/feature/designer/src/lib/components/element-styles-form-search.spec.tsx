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
// The panel's BoxStyler reads `palette.surface`, which only the editor's own
// theme carries — a bare `createTheme()` renders the panel not at all.
import { consoleThemeCssVar, ThemeProvider } from '@aglyn/shared-ui-theme'
import { act, fireEvent, render, screen } from '@testing-library/react'

import ElementStylesForm from './element-styles-form.component'

/**
 * Searching the styles panel (AGL-2486, item 13).
 *
 * `style-field-search.spec.ts` holds the ranking and the alias index; this
 * file is about the PANEL — that a match opens its section, that a section
 * with nothing to show goes away rather than rendering empty, and that
 * clearing the box puts the whole panel back.
 */
describe('styles panel search (AGL-2486)', () => {
  const seedNode = () => {
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes({
      root: { $id: 'root', componentId: 'muiStack', nodes: ['meta'] },
      meta: {
        $id: 'meta',
        componentId: 'muiStack',
        parentId: 'root',
        sx: {},
      },
    } as any)
    return Aglyn.canvas.getNode('meta') as Aglyn.NodeSchema
  }

  const renderPanel = async () => {
    const node = seedNode()
    render(
      <ThemeProvider theme={consoleThemeCssVar}>
        <ElementStylesForm node={node} />
      </ThemeProvider>,
    )
    // The field editors are code-split (next/dynamic).
    await act(async () => undefined)
  }

  const search = async (text: string) => {
    act(() => {
      fireEvent.change(screen.getByLabelText('Search styles'), {
        target: { value: text },
      })
    })
    await act(async () => undefined)
  }

  const section = (summary: string) => screen.queryByText(summary)

  it('shows every section while the box is empty', async () => {
    // The negative control for everything below: a panel that hid sections
    // unconditionally would pass the filtering assertions.
    await renderPanel()
    expect(section('Colors')).toBeTruthy()
    expect(section('Typography')).toBeTruthy()
    expect(section('Borders & Shadows')).toBeTruthy()
    expect(section('Visibility')).toBeTruthy()
    expect(section('Classes & custom CSS')).toBeTruthy()
  })

  it('keeps only the sections that answer the query', async () => {
    await renderPanel()
    await search('rounded')
    expect(section('Borders & Shadows')).toBeTruthy()
    expect(section('Colors')).toBeNull()
    expect(section('Typography')).toBeNull()
    expect(section('Visibility')).toBeNull()
  })

  it('opens the matching section, because a hidden hit is not a hit', async () => {
    // MUI keeps a collapsed accordion's children mounted, so presence of the
    // field proves nothing — the accordion's own expanded state does.
    const expanded = (summary: string) =>
      (
        screen.getByText(summary).closest('.MuiAccordionSummary-root') as
          | HTMLElement
          | undefined
      )?.getAttribute('aria-expanded')

    await renderPanel()
    expect(expanded('Borders & Shadows')).toBe('false')
    await search('rounded')
    expect(expanded('Borders & Shadows')).toBe('true')
    expect(screen.getByLabelText('Corner Radius')).toBeTruthy()
  })

  it('shows only the matching fields inside the section it opens', async () => {
    await renderPanel()
    await search('rounded')
    expect(screen.getByLabelText('Corner Radius')).toBeTruthy()
    // A sibling of the match, in the same accordion, that the query does
    // not answer.
    expect(screen.queryByLabelText('Border Color')).toBeNull()
  })

  it('finds the shadow control by the word `shadow`', async () => {
    await renderPanel()
    await search('shadow')
    expect(screen.getByLabelText('Shadow')).toBeTruthy()
  })

  it('finds the hand-rendered sections too', async () => {
    // The device bands are switches the panel draws itself — searchable
    // only because they are indexed as a section.
    await renderPanel()
    await search('hide on mobile')
    expect(section('Visibility')).toBeTruthy()
    expect(section('Colors')).toBeNull()
  })

  it('says so when nothing matches, instead of emptying itself', async () => {
    await renderPanel()
    await search('zzzzz')
    expect(screen.getByText(/No style matches/)).toBeTruthy()
  })

  it('puts the whole panel back when the box is cleared', async () => {
    await renderPanel()
    await search('rounded')
    expect(section('Colors')).toBeNull()
    await search('')
    expect(section('Colors')).toBeTruthy()
    expect(section('Typography')).toBeTruthy()
    expect(screen.queryByText(/No style matches/)).toBeNull()
  })
})
