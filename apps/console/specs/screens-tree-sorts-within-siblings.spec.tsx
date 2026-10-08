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
 * The Pages tree sorts by its column headers WITHIN each sibling group
 * (AGL-3680): a sorted tree is still a tree, the manual drag order is the
 * default and the third click's destination, and the drag handles stand
 * down while a header sort is on.
 */

import {
  nextScreenSort,
  ScreensHierarchyTableComponent,
  screenSortValue,
  type ScreenHierarchyRow,
} from '../components/screens-hierarchy-table.component'
import { fireEvent, render, screen, within } from '@testing-library/react'

jest.mock('next/navigation', () => ({ usePathname: () => '/' }))

const screens: ScreenHierarchyRow[] = [
  { $id: 'b-root', displayName: 'Bravo', order: 0 },
  { $id: 'a-root', displayName: 'Alpha', order: 1 },
  { $id: 'kid-z', displayName: 'Zulu', parentId: 'b-root', order: 0 },
  { $id: 'kid-y', displayName: 'Yankee', parentId: 'b-root', order: 1 },
]

const renderTable = () =>
  render(
    <ScreensHierarchyTableComponent
      screens={screens}
      onMoveScreen={() => undefined}
      renderRowActions={() => null}
    />,
  )

/** The names of the top-level rows, in order. */
const rootNames = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(':scope table > tbody > tr'))
    .map((row) => row.querySelectorAll(':scope > td')[1]?.textContent ?? '')
    .filter((name) => ['Alpha', 'Bravo'].includes(name))

describe('nextScreenSort', () => {
  it('cycles ascending, descending, then manual order', () => {
    const asc = nextScreenSort(null, 'displayName')
    expect(asc).toEqual({ field: 'displayName', direction: 'asc' })
    const desc = nextScreenSort(asc, 'displayName')
    expect(desc).toEqual({ field: 'displayName', direction: 'desc' })
    expect(nextScreenSort(desc, 'displayName')).toBeNull()
    expect(nextScreenSort(desc, 'updatedAt')).toEqual({ field: 'updatedAt', direction: 'asc' })
  })
})

describe('screenSortValue', () => {
  it('reads the Path column as the address the row prints, none for a group', () => {
    expect(screenSortValue({ $id: 'x' }, 'path', { routingMap: { x: 'about' } })).toBe('/about')
    expect(screenSortValue({ $id: 'g', kind: 'group' }, 'path', { routingMap: { g: 'g' } })).toBeNull()
    expect(screenSortValue({ $id: 'x' }, 'displayName')).toBeNull()
  })
})

describe('the Pages tree header sort (AGL-3680)', () => {
  it('starts in manual order, sorts each level by a header, and returns on the third click', () => {
    const { container } = renderTable()
    expect(rootNames(container)).toEqual(['Bravo', 'Alpha'])

    const header = screen.getByRole('button', { name: 'Display name' })
    fireEvent.click(header)
    expect(rootNames(container)).toEqual(['Alpha', 'Bravo'])
    expect(screen.getByText(/Sorted by Display name within each level/)).toBeTruthy()

    fireEvent.click(header)
    expect(rootNames(container)).toEqual(['Bravo', 'Alpha'])

    fireEvent.click(header)
    expect(rootNames(container)).toEqual(['Bravo', 'Alpha'])
    expect(screen.queryByText(/Sorted by/)).toBeNull()
  })

  it('keeps children under their parent, sorted among themselves', () => {
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: 'Display name' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand children' }))
    const nested = screen.getByRole('table', { name: 'Pages nested under Bravo' })
    const names = within(nested)
      .getAllByRole('row')
      .map((row) => row.querySelectorAll('td')[1]?.textContent)
      .filter(Boolean)
    expect(names).toEqual(['Yankee', 'Zulu'])
  })

  it('stands the drag handles down while sorted, and says why', () => {
    renderTable()
    expect((screen.getByRole('button', { name: 'Drag Alpha' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Updated' }))
    const handles = screen.getAllByRole('button', { name: /Drag to reorder works in manual order/ })
    expect(handles.length).toBeGreaterThan(0)
    for (const handle of handles) expect((handle as HTMLButtonElement).disabled).toBe(true)
  })

  it('leaves Actions unsortable', () => {
    renderTable()
    expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull()
    for (const name of ['Display name', 'ID', 'Path', 'Description', 'Updated', 'Published']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })
})
