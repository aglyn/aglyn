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
 * The staff org usage table draws plugin columns between Forms and Cost
 * (AGL-2984): each column's header in the head row, its cell in every month
 * row with `{ month, orgId }`, and the detail line under a month spanning the
 * core columns and the contributed ones together. Proven with two plugins
 * that have nothing to do with each other — a backups quota and a reviews
 * count.
 */

import { render, screen } from '@testing-library/react'
import type { PluginListColumn } from '../components/plugin-list-columns.component'
import StaffOrgUsageTable, {
  STAFF_ORG_USAGE_COLUMNS,
  type StaffOrgUsageMonth,
} from '../components/staff-org-usage-table.component'

const month = (key: string): StaffOrgUsageMonth => ({
  month: key,
  storageGb: 1.5,
  pageViews: 1_200,
  formSubmissions: 7,
  costUsd: 2.25,
  deltas: null,
})

function BackupsCell(props: { month: StaffOrgUsageMonth; orgId: string }) {
  return <span>{`backups:${props.month.month}@${props.orgId}`}</span>
}

function ReviewsHeader(props: { orgId: string }) {
  return <span>{`Reviews@${props.orgId}`}</span>
}

function ReviewsCell(props: { month: StaffOrgUsageMonth }) {
  return <span>{`reviews:${props.month.month}`}</span>
}

const COLUMNS: PluginListColumn[] = [
  {
    widgetId: 'backups-quota',
    header: 'Backups (GB)',
    align: 'right',
    Component: BackupsCell,
  },
  {
    widgetId: 'reviews-written',
    header: 'Reviews',
    Header: ReviewsHeader,
    Component: ReviewsCell,
  },
]

const headers = () =>
  screen.getAllByRole('columnheader').map((cell) => cell.textContent)

describe('plugin columns on the staff org usage table (AGL-2984)', () => {
  it('keeps five core columns of its own', () => {
    expect(STAFF_ORG_USAGE_COLUMNS).toEqual([
      'Month',
      'Page views',
      'Storage GB',
      'Forms',
      'Cost',
    ])
  })

  it('draws two plugins’ headers between Forms and Cost, in registration order', () => {
    render(
      <StaffOrgUsageTable
        months={[month('2026-08')]}
        columns={COLUMNS}
        orgId="org-1"
      />,
    )
    expect(headers()).toEqual([
      'Month',
      'Page views',
      'Storage GB',
      'Forms',
      'Backups (GB)',
      'Reviews@org-1',
      'Cost',
    ])
  })

  it('draws each column’s cell in every month row, with the month and the org, before Cost', () => {
    render(
      <StaffOrgUsageTable
        months={[month('2026-08'), month('2026-07')]}
        columns={COLUMNS}
        orgId="org-1"
      />,
    )
    const figures = screen
      .getAllByRole('row')
      .slice(1)
      .filter((row) => row.children.length > 1)
    expect(figures).toHaveLength(2)
    expect([...figures[0].children].map((cell) => cell.textContent)).toEqual([
      '2026-08',
      '1,200',
      '1.50',
      '7',
      'backups:2026-08@org-1',
      'reviews:2026-08',
      '$2.25',
    ])
    expect(screen.getByText('backups:2026-07@org-1')).toBeTruthy()
  })

  it('spans the detail line across the core and contributed columns together', () => {
    const { container } = render(
      <StaffOrgUsageTable
        months={[month('2026-08')]}
        columns={COLUMNS}
        orgId="org-1"
      />,
    )
    const detail = container.querySelector('td[colspan]')
    expect(detail?.getAttribute('colspan')).toBe('7')
  })

  it('draws the core table alone when no plugin contributes', () => {
    const { container } = render(
      <StaffOrgUsageTable months={[month('2026-08')]} />,
    )
    expect(headers()).toEqual([
      'Month',
      'Page views',
      'Storage GB',
      'Forms',
      'Cost',
    ])
    expect(container.querySelector('td[colspan]')?.getAttribute('colspan')).toBe(
      '5',
    )
  })

  it('draws no columns at all over no months', () => {
    render(<StaffOrgUsageTable months={[]} columns={COLUMNS} orgId="org-1" />)
    expect(screen.queryAllByRole('columnheader')).toHaveLength(0)
    expect(
      screen.getByText('No usage rollups recorded for this organization yet.'),
    ).toBeTruthy()
  })
})
