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
 * The shared "Next activity" column and its filter toggle (AGL-2661).
 *
 * What has to hold: the column reads the stored time and nothing else —
 * absent, null and a bad value all draw the dash; and the toggle writes
 * the one clause `withNoNextActivity` spells, on and off, leaving the
 * view's other clauses alone.
 */

import { CRM_NEXT_ACTIVITY_FIELD, CRM_NO_NEXT_ACTIVITY_CLAUSE } from '@aglyn/aglyn'
import { fireEvent, render, screen } from '@testing-library/react'
import { NoNextActivityToggle, nextActivityColumn } from './crm-next-activity-column'

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

describe('NoNextActivityToggle', () => {
  it('adds the clause when clicked off, removes it when clicked on, and keeps the rest', () => {
    const owner = { field: 'ownerUid', op: 'equals', value: 'u1' }
    const onChange = jest.fn()
    const { rerender } = render(<NoNextActivityToggle filters={[owner]} onChange={onChange} />)
    const chip = screen.getByRole('button', { name: 'No next activity' })
    expect(chip.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(chip)
    expect(onChange).toHaveBeenCalledWith([owner, CRM_NO_NEXT_ACTIVITY_CLAUSE])

    rerender(
      <NoNextActivityToggle filters={[owner, CRM_NO_NEXT_ACTIVITY_CLAUSE]} onChange={onChange} />,
    )
    expect(screen.getByRole('button', { name: 'No next activity' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'No next activity' }))
    expect(onChange).toHaveBeenLastCalledWith([owner])
  })
})
