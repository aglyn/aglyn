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
 * The column contract (AGL-2940): a widget on a column zone declares a
 * `column` and the table draws its header and mounts its component per row
 * with the row beside the zone's props. A widget on the same zone WITHOUT
 * a column is not a column and must not become one by accident.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material'

let mockWidgets: Array<Record<string, unknown>>

jest.mock('../components/plugin-widget-slot.component', () => ({
  __esModule: true,
  default: () => null,
  useSlotWidgets: () => ({ widgets: mockWidgets, ready: true }),
}))

import {
  PluginListColumnCells,
  PluginListColumnHeaders,
  usePluginColumnSort,
  usePluginListColumns,
} from '../components/plugin-list-columns.component'

function UsageCell(props: { member: { $id: string }; orgId: string }) {
  return <span>{`usage:${props.member.$id}@${props.orgId}`}</span>
}

function Card() {
  return <div>{'a card, not a column'}</div>
}

function Team(props: { rows: Array<{ $id: string }> }) {
  const { columns } = usePluginListColumns('orgMembersListColumn')
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableCell>{'Member'}</TableCell>
          <PluginListColumnHeaders columns={columns} />
        </TableRow>
      </TableHead>
      <TableBody>
        {props.rows.map((row) => (
          <TableRow key={row.$id}>
            <TableCell>{row.$id}</TableCell>
            <PluginListColumnCells columns={columns} member={row} orgId="org-1" />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

describe('usePluginListColumns', () => {
  it('draws a contributed column: its header once, its cell per row, with the row', () => {
    mockWidgets = [
      {
        widgetId: 'ai-usage',
        title: 'AI usage',
        column: { header: 'AI this month', sortKey: 'aiCredits', align: 'right' },
        Component: UsageCell,
      },
      { widgetId: 'ai-card', title: 'AI card', Component: Card },
    ]
    render(<Team rows={[{ $id: 'u1' }, { $id: 'u2' }]} />)
    expect(screen.getByText('AI this month')).toBeTruthy()
    expect(screen.getByText('usage:u1@org-1')).toBeTruthy()
    expect(screen.getByText('usage:u2@org-1')).toBeTruthy()
    // The card registered on the column zone is not a column.
    expect(screen.queryByText('a card, not a column')).toBeNull()
  })

  it('carries the sort key and alignment for a table that orders by them', () => {
    mockWidgets = [
      {
        widgetId: 'ai-usage',
        column: { header: 'AI', sortKey: 'aiCredits', align: 'right' },
        Component: UsageCell,
      },
    ]
    let seen: unknown
    function Probe() {
      seen = usePluginListColumns('orgMembersListColumn').columns
      return null
    }
    render(<Probe />)
    expect(seen).toEqual([
      expect.objectContaining({
        widgetId: 'ai-usage',
        header: 'AI',
        sortKey: 'aiCredits',
        align: 'right',
      }),
    ])
  })

  it('a second plugin contributes a second column in registration order', () => {
    mockWidgets = [
      { widgetId: 'ai-usage', column: { header: 'AI' }, Component: UsageCell },
      {
        widgetId: 'backups-quota',
        column: { header: 'Backups' },
        Component: (props: { member: { $id: string } }) => (
          <span>{`backups:${props.member.$id}`}</span>
        ),
      },
    ]
    render(<Team rows={[{ $id: 'u1' }]} />)
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual(['Member', 'AI', 'Backups'])
    expect(screen.getByText('backups:u1')).toBeTruthy()
  })

  it('an empty zone draws no header and no cells', () => {
    mockWidgets = []
    render(<Team rows={[{ $id: 'u1' }]} />)
    expect(screen.getAllByRole('columnheader')).toHaveLength(1)
  })
})

/**
 * A column that sorts by what only its plugin reads (AGL-2939): the column's
 * own `Header` hands the table a comparator, and the table keeps one sort at
 * a time. Proven with a plugin that has nothing to do with AI — a reviews
 * plugin ordering the roster by each member's reviews written.
 */
describe('usePluginColumnSort', () => {
  const REVIEWS: Record<string, number> = { u1: 2, u2: 9, u3: 5 }

  function ReviewsHeader(props: {
    orgId: string
    sorted: boolean
    onSort: (compare: ((a: { $id: string }, b: { $id: string }) => number) | null) => void
  }) {
    return (
      <span>
        {`Reviews@${props.orgId}${props.sorted ? ' (sorted)' : ''}`}
        <button
          type="button"
          onClick={() => props.onSort((a, b) => REVIEWS[b.$id] - REVIEWS[a.$id])}
        >
          {'most reviews'}
        </button>
        <button type="button" onClick={() => props.onSort(null)}>
          {'unsorted'}
        </button>
      </span>
    )
  }

  function SortableTeam(props: { rows: Array<{ $id: string }> }) {
    const { columns } = usePluginListColumns('orgMembersListColumn')
    const { rows, sortedBy, onSort } = usePluginColumnSort(props.rows)
    return (
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>{'Member'}</TableCell>
            <PluginListColumnHeaders
              columns={columns}
              onSort={onSort}
              sortedBy={sortedBy}
              orgId="org-1"
            />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.$id}>
              <TableCell>{row.$id}</TableCell>
              <PluginListColumnCells columns={columns} member={row} orgId="org-1" />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  const memberOrder = () =>
    screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.firstElementChild?.textContent)

  beforeEach(() => {
    mockWidgets = [
      {
        widgetId: 'reviews-written',
        column: { header: 'Reviews', Header: ReviewsHeader },
        Component: (props: { member: { $id: string } }) => (
          <span>{`reviews:${REVIEWS[props.member.$id]}`}</span>
        ),
      },
    ]
  })

  it("draws the column's own header with the slot's props", () => {
    render(<SortableTeam rows={[{ $id: 'u1' }]} />)
    expect(screen.getByText('Reviews@org-1')).toBeTruthy()
  })

  it('orders the rows by the comparator the header hands over, and restores them on null', () => {
    render(<SortableTeam rows={[{ $id: 'u1' }, { $id: 'u2' }, { $id: 'u3' }]} />)
    expect(memberOrder()).toEqual(['u1', 'u2', 'u3'])
    fireEvent.click(screen.getByText('most reviews'))
    expect(memberOrder()).toEqual(['u2', 'u3', 'u1'])
    expect(screen.getByText('Reviews@org-1 (sorted)')).toBeTruthy()
    fireEvent.click(screen.getByText('unsorted'))
    expect(memberOrder()).toEqual(['u1', 'u2', 'u3'])
  })

  it('a column without a Header still draws its header text', () => {
    mockWidgets = [{ widgetId: 'plain', column: { header: 'Plain' }, Component: UsageCell }]
    render(<SortableTeam rows={[{ $id: 'u1' }]} />)
    expect(screen.getByText('Plain')).toBeTruthy()
  })
})
