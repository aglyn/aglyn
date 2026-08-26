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

/**
 * Opening a parent must not move the columns (AGL-693).
 *
 * Under the browser's default `table-layout: auto` a column is as wide as the
 * widest cell in it, counted over the rows that are MOUNTED — so revealing a
 * child re-measured all eight columns at once and the table stepped sideways
 * under the reader. The deeper indent in the leading column pushed the same
 * way, in the same direction.
 *
 * jsdom performs no layout, so this cannot measure a rendered column. It does
 * not need to: the widths are DECLARED in a `colgroup`, which is exactly the
 * change, and a declared width is readable without a layout engine. What the
 * assertions pin is that those declarations are the same before and after an
 * expand, and that the nested table a child lives in repeats them — a child
 * whose columns are declared differently would not line up under its parent.
 */

import {
  ScreensHierarchyTableComponent,
  type ScreenHierarchyRow,
} from '../components/screens-hierarchy-table.component'
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('next/navigation', () => ({ usePathname: () => '/' }))

const screens: ScreenHierarchyRow[] = [
  { $id: 'solutions', displayName: 'Solutions' },
  {
    $id: 'child-a',
    displayName: 'A child with a considerably longer display name',
    description:
      'And a description long enough that an auto-layout table would have ' +
      'widened its column to fit it.',
    parentId: 'solutions',
    order: 0,
  },
  { $id: 'child-b', displayName: 'Second child', parentId: 'solutions', order: 1 },
  { $id: 'about', displayName: 'About' },
]

const renderTable = () =>
  render(
    <ScreensHierarchyTableComponent
      screens={screens}
      onMoveScreen={() => undefined}
      renderRowActions={() => null}
    />,
  )

/** The declared width of each column of a table, in document order. */
const columnWidths = (table: Element) =>
  Array.from(table.querySelectorAll(':scope > colgroup > col')).map(
    (col) => (col as HTMLElement).style.width,
  )

describe('expanding a screen holds the columns still (AGL-693)', () => {
  it('declares the same widths before and after an expand', () => {
    const { container } = renderTable()
    const root = container.querySelector('table') as Element

    const before = columnWidths(root)
    expect(before).toHaveLength(8)
    expect(before.every(Boolean)).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Expand children' }))

    expect(columnWidths(root)).toEqual(before)
  })

  it('gives the children the same column widths as their parent', () => {
    const { container } = renderTable()
    const root = container.querySelector('table') as Element
    fireEvent.click(screen.getByRole('button', { name: 'Expand children' }))

    const nested = container.querySelectorAll('table')
    expect(nested.length).toBeGreaterThan(1)
    expect(columnWidths(nested[1])).toEqual(columnWidths(root))
  })

  it('lays the table out from those widths, not from its rows', () => {
    const { container } = renderTable()
    for (const table of Array.from(container.querySelectorAll('table'))) {
      expect(getComputedStyle(table).tableLayout).toBe('fixed')
    }
  })

  it('mounts a subtree only while it is open', () => {
    renderTable()
    expect(screen.queryByText('Second child')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Expand children' }))
    expect(screen.getByText('Second child')).toBeTruthy()
  })

  it('slides the subtree in rather than inserting it', () => {
    // The premise the reduced-motion test below rests on: there IS a
    // transition to suppress. Without this, a zero duration would prove
    // nothing at all.
    const { container } = renderTable()
    fireEvent.click(screen.getByRole('button', { name: 'Expand children' }))

    const collapse = container.querySelector('.MuiCollapse-root') as HTMLElement
    expect(collapse).toBeTruthy()
    expect(parseFloat(collapse.style.transitionDuration)).toBeGreaterThan(0)
  })

  it('drops the slide for a reader who asked for less motion', () => {
    const realMatchMedia = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    try {
      const { container } = renderTable()
      fireEvent.click(screen.getByRole('button', { name: 'Expand children' }))

      const collapse = container.querySelector('.MuiCollapse-root') as HTMLElement
      // The disclosure still happens — the rows simply arrive in place.
      expect(collapse.style.transitionDuration).toBe('0ms')
      expect(screen.getByText('Second child')).toBeTruthy()
    } finally {
      window.matchMedia = realMatchMedia
    }
  })
})
