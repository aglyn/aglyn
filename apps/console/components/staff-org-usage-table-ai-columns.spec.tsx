/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 * The two AI columns on the staff usage table (AGL-2930): present, in
 * order, and — the assertion that matters — a rollup written before the
 * credit meter renders a DASH, never a zero. `0` there would state, as
 * measurement, that the organization used no AI in a month nobody measured.
 */

import { render, screen } from '@testing-library/react'

jest.mock('@aglyn/aglyn', () => ({
  __esModule: true,
  aiAddonName: () => 'Acme AI',
}))

import StaffOrgUsageTable, {
  aiCreditsCell,
  aiOverageCell,
  STAFF_ORG_USAGE_COLUMNS,
  type StaffOrgUsageMonth,
} from './staff-org-usage-table.component'

const month = (overrides: Partial<StaffOrgUsageMonth>): StaffOrgUsageMonth => ({
  month: '2026-08',
  storageGb: 1,
  pageViews: 10,
  formSubmissions: 1,
  costUsd: 2,
  assistCostUsd: 1.234,
  deltas: null,
  ...overrides,
})

describe('staff usage table AI columns (AGL-2930)', () => {
  it('carries the two columns beside Assist, before Cost', () => {
    expect(STAFF_ORG_USAGE_COLUMNS).toEqual([
      'Month',
      'Page views',
      'Storage GB',
      'Forms',
      'Assist',
      'AI credits used',
      'AI overage billed ($)',
      'Cost',
    ])
  })

  it('renders the recorded credits and the billed overage per month', () => {
    render(
      <StaffOrgUsageTable
        months={[
          month({ month: '2026-08', assistCredits: 1_234, assistOverageUsd: 3.5 }),
          month({ month: '2026-07', assistCredits: null, assistOverageUsd: null }),
        ]}
      />,
    )
    expect(screen.getByText('AI credits used')).toBeTruthy()
    expect(screen.getByText('AI overage billed ($)')).toBeTruthy()
    expect(screen.getByText('1,234')).toBeTruthy()
    expect(screen.getByText('$3.50')).toBeTruthy()
    // The July row predates the meter: two dashes, no zeros.
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('renders null as a dash and a value as itself', () => {
    expect(aiCreditsCell(null)).toBe('—')
    expect(aiCreditsCell(undefined)).toBe('—')
    expect(aiCreditsCell(0)).toBe('0')
    expect(aiCreditsCell(18_750)).toBe('18,750')
    expect(aiOverageCell(null)).toBe('—')
    expect(aiOverageCell(0)).toBe('$0.00')
    expect(aiOverageCell(6.25)).toBe('$6.25')
  })
})
