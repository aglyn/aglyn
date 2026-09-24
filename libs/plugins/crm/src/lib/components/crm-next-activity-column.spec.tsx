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
 * The shared "Next activity" column and its filter (AGL-2661, AGL-3313).
 *
 * What has to hold: the column reads the stored time and nothing else —
 * absent, null and a bad value all draw the dash; and the grid panel's
 * "is empty" on it writes the one clause the old toggle wrote, so a view
 * saved with the toggle on reads the same.
 */

import {
  CRM_NEXT_ACTIVITY_FIELD,
  CRM_NO_NEXT_ACTIVITY_CLAUSE,
  isNoNextActivityClause,
} from '@aglyn/aglyn'
import { render } from '@testing-library/react'
import { listFilterGridColumns, listPlainCodec } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import {
  CRM_NEXT_ACTIVITY_FILTER_FIELD,
  nextActivityColumn,
} from './crm-next-activity-column'

const NOW = Date.parse('2026-09-08T12:00:00Z')

describe('nextActivityColumn', () => {
  const column = nextActivityColumn(NOW)

  it('is the stored time as a date, and null for anything else', () => {
    expect(column.field).toBe(CRM_NEXT_ACTIVITY_FIELD)
    expect((column.valueGetter as any)(undefined, { nextTaskAtMs: NOW + 1000 })).toEqual(
      new Date(NOW + 1000),
    )
    expect((column.valueGetter as any)(undefined, { nextTaskAtMs: null })).toBeNull()
    expect((column.valueGetter as any)(undefined, {})).toBeNull()
    expect((column.valueGetter as any)(undefined, { nextTaskAtMs: 'soon' })).toBeNull()
    expect(column.sortable).toBe(false)
    expect(column.filterable).toBe(false)
  })

  it('draws a dash for nothing scheduled and a due label for a time', () => {
    const { container: blank } = render((column.renderCell as any)({ row: {} }))
    expect(blank.textContent).toBe('—')
    const { container } = render(
      (column.renderCell as any)({ row: { nextTaskAtMs: NOW - 2 * 24 * 3600 * 1000 } }),
    )
    expect(container.textContent).not.toBe('—')
    expect(container.textContent).toMatch(/overdue|ago|day/i)
  })
})

describe('the "No next activity" filter', () => {
  it('offers "is empty" alone on the column, and writes the clause the toggle wrote', () => {
    const [column] = listFilterGridColumns([nextActivityColumn(NOW)], [CRM_NEXT_ACTIVITY_FILTER_FIELD])
    expect(column.filterable).toBe(true)
    expect(column.filterOperators?.map((operator) => operator.value)).toEqual(['isEmpty'])

    const clause = listPlainCodec.toClause({
      id: 'crm',
      field: CRM_NEXT_ACTIVITY_FIELD,
      operator: 'isEmpty',
    })
    expect(clause && isNoNextActivityClause(clause)).toBe(true)
    // A view saved with the toggle on shows in the panel as that operator.
    expect(listPlainCodec.toItem(CRM_NO_NEXT_ACTIVITY_CLAUSE)?.operator).toBe('isEmpty')
  })
})
