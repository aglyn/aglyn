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
 * A plugin's columns on a DataGrid list (AGL-2984). A zone's columns become
 * column definitions the grid neither sorts nor filters; a column's own
 * `Header` is drawn with the zone's props, whether the rows are in its
 * order, and a sort handler bound to it that holds still across rebuilds;
 * its cell is drawn with the row's props beside the zone's. The staff
 * Organizations list draws its zone through it, after its limits and before
 * Created. Proven with two plugins unrelated to each other and to the list —
 * a reviews count that sorts and a backups quota that does not.
 */

import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import {
  pluginGridColumns,
  useStablePluginColumns,
} from '../components/plugin-grid-columns.component'
import type { PluginListColumn } from '../components/plugin-list-columns.component'

type Row = { $id: string }
type Compare = (a: Row, b: Row) => number

const REVIEWS: Record<string, number> = { 'org-1': 2, 'org-2': 9 }
const seenHandlers = new Set<unknown>()

function ReviewsHeader(props: {
  orgIds: string[]
  sorted: boolean
  onSort: (compare: Compare | null) => void
}) {
  seenHandlers.add(props.onSort)
  return (
    <button
      type="button"
      onClick={() => props.onSort((a, b) => REVIEWS[b.$id] - REVIEWS[a.$id])}
    >
      {`Reviews over ${props.orgIds.length}${props.sorted ? ' (sorted)' : ''}`}
    </button>
  )
}

function ReviewsCell(props: { row: Row; orgId: string; orgIds: string[] }) {
  return (
    <span>{`reviews:${props.orgId}:${REVIEWS[props.row.$id]} of ${props.orgIds.length}`}</span>
  )
}

function BackupsCell(props: { orgId: string }) {
  return <span>{`backups:${props.orgId}`}</span>
}

const COLUMNS: PluginListColumn[] = [
  {
    widgetId: 'reviews-written',
    header: 'Reviews',
    align: 'right',
    Header: ReviewsHeader,
    Component: ReviewsCell,
  },
  { widgetId: 'backups-quota', header: 'Backups', Component: BackupsCell },
]

const ORG_IDS = ['org-1', 'org-2']
const rowProps = (row: Row) => ({ row, orgId: row.$id })

const build = (sortedBy: string | null, onSort: jest.Mock = jest.fn()) =>
  pluginGridColumns<Row>(COLUMNS, {
    slotProps: { orgIds: ORG_IDS },
    sortedBy,
    onSort,
    rowProps,
  })

const header = (sortedBy: string | null, onSort?: jest.Mock) =>
  build(sortedBy, onSort)[0].renderHeader?.({} as never) as ReactNode

beforeEach(() => seenHandlers.clear())

describe('pluginGridColumns', () => {
  it('maps each column to a definition the grid neither sorts nor filters', () => {
    const columns = build(null)
    expect(columns.map((column) => column.field)).toEqual([
      'plugin-reviews-written',
      'plugin-backups-quota',
    ])
    expect(columns.map((column) => column.headerName)).toEqual([
      'Reviews',
      'Backups',
    ])
    for (const column of columns) {
      expect(column.sortable).toBe(false)
      expect(column.filterable).toBe(false)
    }
    expect(columns[0]).toEqual(
      expect.objectContaining({ align: 'right', headerAlign: 'right' }),
    )
  })

  it("draws a column's own header with the zone's props and whether the rows are in its order", () => {
    const { unmount } = render(header(null))
    expect(screen.getByText('Reviews over 2')).toBeTruthy()
    unmount()
    render(header('reviews-written'))
    expect(screen.getByText('Reviews over 2 (sorted)')).toBeTruthy()
  })

  it('binds the sort handler to its column, and keeps it one handler across rebuilds', () => {
    const onSort = jest.fn()
    const { rerender } = render(header(null, onSort))
    rerender(header('reviews-written', onSort))
    rerender(header('backups-quota', onSort))
    fireEvent.click(screen.getByText('Reviews over 2'))
    expect(onSort).toHaveBeenCalledWith('reviews-written', expect.any(Function))
    const compare = onSort.mock.calls[0][1] as Compare
    expect(
      [{ $id: 'org-1' }, { $id: 'org-2' }].sort(compare).map((row) => row.$id),
    ).toEqual(['org-2', 'org-1'])
    // One handler for the life of the header, however often the grid's
    // columns are rebuilt around it.
    expect(seenHandlers.size).toBe(1)
  })

  it('leaves a column without a Header to the grid, titled by its header text', () => {
    const columns = build(null)
    expect(columns[1].renderHeader).toBeUndefined()
    expect(columns[1].headerName).toBe('Backups')
  })

  it("draws each cell with its row's props beside the zone's", () => {
    const columns = build(null)
    render(
      <>
        {columns[0].renderCell?.({ row: { $id: 'org-2' } } as never)}
        {columns[1].renderCell?.({ row: { $id: 'org-1' } } as never)}
      </>,
    )
    expect(screen.getByText('reviews:org-2:9 of 2')).toBeTruthy()
    expect(screen.getByText('backups:org-1')).toBeTruthy()
  })
})

describe('useStablePluginColumns', () => {
  it('holds one array while the same widgets contribute, and takes the new one when they change', () => {
    const { result, rerender } = renderHook(
      (props: { columns: PluginListColumn[] }) =>
        useStablePluginColumns(props.columns),
      { initialProps: { columns: [...COLUMNS] } },
    )
    const first = result.current
    rerender({ columns: [...COLUMNS] })
    expect(result.current).toBe(first)
    const fewer = [COLUMNS[1]]
    rerender({ columns: fewer })
    expect(result.current).toBe(fewer)
  })
})

describe('the staff Organizations list draws its zone through it', () => {
  const page = readFileSync(
    join(__dirname, '..', 'app/(app)/admin/orgs/page.tsx'),
    'utf8',
  )

  it('reads the zone, orders its own rows, and hands the grid those rows', () => {
    expect(page).toContain("usePluginListColumns('staffOrgsListColumn')")
    expect(page).toContain('usePluginColumnSort(orgs)')
    expect(page).toContain('pluginGridColumns(pluginColumns, {')
    expect(page).toContain('rows={sortedOrgs}')
  })

  it('places the columns after the limits and before Created', () => {
    const limits = page.indexOf("field: 'siteLimit'")
    const plugins = page.indexOf('...pluginGridCols')
    const created = page.indexOf("field: 'createdAt'")
    expect(limits).toBeGreaterThan(0)
    expect(plugins).toBeGreaterThan(limits)
    expect(created).toBeGreaterThan(plugins)
  })
})
