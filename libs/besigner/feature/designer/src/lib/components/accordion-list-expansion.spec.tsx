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

import { consoleThemeCssVar, ThemeProvider } from '@aglyn/shared-ui-theme'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'

import { Accordion, AccordionListComponent } from './accordion-list.component'

const theme = consoleThemeCssVar

/**
 * Which groups are OPEN, read the way a screen reader would (AGL-2486).
 *
 * Not "which groups are in the DOM": a collapsed accordion keeps its whole
 * subtree mounted, so a group that renders shut still answers every query
 * about its contents while showing the user nothing.
 */
const expandedGroups = () =>
  Array.from(document.querySelectorAll('.MuiAccordionSummary-root'))
    .filter((summary) => summary.getAttribute('aria-expanded') === 'true')
    .map((summary) => (summary.textContent || '').trim())

type Group = { $id: string; label: string }

function List({ groups }: { groups: Group[] }) {
  return (
    <ThemeProvider theme={theme}>
      <AccordionListComponent
        items={groups}
        defaultExpanded={groups.map((group) => group.$id)}
        getItemId={(group) => group.$id}
        onRenderSummary={({ item }) => <>{item.label}</>}
        onRenderDetail={({ item }) => <div>{`${item.label} contents`}</div>}
      />
    </ThemeProvider>
  )
}

describe('accordion list expansion (AGL-2486)', () => {
  afterEach(cleanup)

  it('opens a group that only appears after mount', () => {
    const { rerender } = render(<List groups={[{ $id: 'a', label: 'Alpha' }]} />)
    expect(expandedGroups()).toEqual(['Alpha'])

    // The shape the element pickers hit: the results group is built after an
    // await, so it can never be present on the render that changed the query.
    rerender(
      <List
        groups={[
          { $id: 'a', label: 'Alpha' },
          { $id: 'results', label: 'Best matches' },
        ]}
      />,
    )
    expect(expandedGroups()).toEqual(['Alpha', 'Best matches'])
  })

  it('leaves a group the user closed closed, across a search and back', () => {
    const categories = [
      { $id: 'a', label: 'Alpha' },
      { $id: 'b', label: 'Beta' },
    ]
    const { rerender } = render(<List groups={categories} />)
    fireEvent.click(screen.getByText('Alpha'))
    expect(expandedGroups()).toEqual(['Beta'])

    // Searching replaces the categories with the flat results group, so the
    // category accordions UNMOUNT — their own local open state goes with
    // them, and the list is the only thing that still remembers the user
    // closed Alpha.
    rerender(<List groups={[{ $id: 'results', label: 'Best matches' }]} />)
    expect(expandedGroups()).toEqual(['Best matches'])

    // Clearing the search brings them back. Re-deriving the open set from
    // `defaultExpanded` here would re-open Alpha and quietly undo the user;
    // only groups never seen before may be opened. A new group in the same
    // render still opens, so this is not a cap on opening anything.
    rerender(
      <List groups={[...categories, { $id: 'c', label: 'Gamma' }]} />,
    )
    expect(expandedGroups()).toEqual(['Beta', 'Gamma'])
  })

  it('follows a later change to the Accordion expanded prop', () => {
    // `expanded` used to seed local state once and then be ignored, which
    // made it a write-only prop: callers had to remount the accordion with a
    // changing `key` to get it to move at all.
    function Controlled() {
      const [open, setOpen] = useState(false)
      return (
        <ThemeProvider theme={theme}>
          <button type="button" onClick={() => setOpen(true)}>
            {'open it'}
          </button>
          <Accordion expanded={open} summary="Flexbox & Grid">
            <div>{'group contents'}</div>
          </Accordion>
        </ThemeProvider>
      )
    }
    render(<Controlled />)
    expect(expandedGroups()).toEqual([])

    fireEvent.click(screen.getByText('open it'))
    expect(expandedGroups()).toEqual(['Flexbox & Grid'])
  })

  it('still lets the user toggle a group the prop is not moving', () => {
    render(
      <ThemeProvider theme={theme}>
        <Accordion expanded summary="Colors">
          <div>{'group contents'}</div>
        </Accordion>
      </ThemeProvider>,
    )
    expect(expandedGroups()).toEqual(['Colors'])
    fireEvent.click(screen.getByText('Colors'))
    expect(expandedGroups()).toEqual([])
  })
})
