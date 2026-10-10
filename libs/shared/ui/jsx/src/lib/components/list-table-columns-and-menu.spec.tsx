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
 * Two things Zach read as broken on the staff tables (2026-10-09):
 *
 *  - **Manage columns greyed out every filter-only column** ("why are these
 *    columns disabled?"). They were `hideable: false`, which MUI draws as a
 *    disabled checkbox. They are ordinary columns now: hidden by default, a
 *    working checkbox, and a cell that draws the row's value. Only Actions
 *    stays locked.
 *  - **The row menu drew the open-in-new arrow on both sides of "Visit live
 *    site"**: the quick action's own glyph in front, the new-tab mark behind.
 *    One arrow, trailing. And an unavailable item can say why on screen.
 */

import { mdiOpenInNew } from '@aglyn/shared-data-mdi'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ListFilterField } from '../const/list-filter'
import { hiddenFilterVisibility } from '../const/list-filter'
import { listFilterGridColumns } from '../const/list-grid-filter'
import { ListRowActions, ListTable, listActionsColumn } from './list-table.component'

const FIELDS: readonly ListFilterField[] = [
  { column: 'name', kind: 'text', path: 'name', lowerPath: 'nameLower', operators: ['equals'] },
  { column: 'slug', kind: 'exact', path: 'slug', operators: ['equals'] },
  { column: 'suspended', kind: 'boolean', path: 'suspended', operators: ['equals'] },
]
const OPTIONS = {
  suspended: [
    { value: 'true', label: 'Suspended' },
    { value: 'false', label: 'Not suspended' },
  ],
}

describe('Manage columns lists filter-only columns as ordinary, toggleable columns', () => {
  const columns = listFilterGridColumns(
    [
      { field: 'name', headerName: 'Organization', flex: 1 },
      listActionsColumn(() => null),
    ],
    FIELDS,
    OPTIONS,
    { name: 'Organization', slug: 'Org slug', suspended: 'Suspended' },
  )

  it('enables every checkbox but Actions, and an unhidden column draws the row', () => {
    render(
      <ListTable
        rows={[{ $id: 'o1', name: 'Harbor Co', slug: 'harbor', suspended: true }]}
        columns={columns}
        hideFooter
        initialState={{
          columns: { columnVisibilityModel: hiddenFilterVisibility(FIELDS, ['name']) },
        }}
      />,
    )
    // The filter-only columns start hidden.
    expect(screen.queryByText('harbor')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /columns/i }))
    const slug = screen.getByRole('checkbox', { name: 'Org slug' })
    const suspended = screen.getByRole('checkbox', { name: 'Suspended' })
    expect((slug as HTMLInputElement).disabled).toBe(false)
    expect((suspended as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByRole('checkbox', { name: 'Actions' }) as HTMLInputElement).disabled).toBe(true)

    fireEvent.click(slug)
    fireEvent.click(suspended)
    expect(screen.getByRole('gridcell', { name: 'harbor' })).toBeTruthy()
    expect(screen.getByRole('gridcell', { name: 'Suspended' })).toBeTruthy()
  })
})

describe('the row menu draws one open-in-new arrow, and says why an item is unavailable', () => {
  it('"Visit live site" carries the trailing new-tab mark only', () => {
    render(
      <ListRowActions
        label="Harbor Bakery"
        quick={{ icon: mdiOpenInNew.path, label: 'Visit live site', href: 'https://harbor.test' }}
        items={[
          {
            key: 'preview',
            label: 'Preview home page',
            external: true,
            disabled: true,
            disabledReason: 'No home page published yet',
            description: 'No home page published yet',
          },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Harbor Bakery' }))
    const [visit, preview] = screen.getAllByRole('menuitem')
    expect(visit.textContent).toContain('Visit live site')
    expect(visit.querySelectorAll('svg')).toHaveLength(1)
    expect(visit.querySelector('.MuiListItemIcon-root')).toBeNull()
    expect(within(preview).getByText('No home page published yet')).toBeTruthy()
  })
})
