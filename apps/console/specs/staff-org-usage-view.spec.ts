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

import {
  NO_RECORDED_METERS,
  percentChange,
  recordedUsageGroups,
  recordedUsageLines,
  staffOrgUsageRowView,
  type StaffOrgUsageMonth,
} from '../utils/staff-org-usage-view'

const row = (patch: Partial<StaffOrgUsageMonth> = {}): StaffOrgUsageMonth => ({
  month: '2026-08',
  storageGb: 2.345,
  pageViews: 12_340,
  costUsd: 1.2,
  deltas: null,
  ...patch,
})

describe('the staff usage table, as it prints (AGL-3667)', () => {
  it('writes a change as a signed whole percent', () => {
    expect(percentChange(0.084)).toBe('+8%')
    expect(percentChange(-0.031)).toBe('-3%')
  })

  it('keeps each recorded group on a line of its own, and the lines are the groups with something in them', () => {
    const recorded = { emailSends: 10, billableCostUsd: 0.5, siteSizeMb: 12.34, siteSizeTruncated: true }
    const groups = recordedUsageGroups(recorded)
    expect(groups.meters).toBe('Emails 10')
    expect(groups.money).toBe('Billable $0.5000')
    expect(groups.site).toBe('Site size 12.3 MB (at least — measurement truncated)')
    expect(groups.gates).toBe('')
    expect(recordedUsageLines(recorded)).toEqual([groups.meters, groups.money, groups.site])
    expect(recordedUsageLines(undefined)).toEqual([])
  })

  it('prints a row: views and cost with their change, storage to two places', () => {
    const view = staffOrgUsageRowView(row({ deltas: { pageViews: 0.5, costUsd: -0.1 } }))
    expect(view).toMatchObject({ month: '2026-08', views: '12,340 +50%', storage: '2.35 GB', cost: '$1.20 -10%' })
  })

  it('says plainly that a month recorded nothing beyond the core meters, rather than leaving it blank', () => {
    expect(staffOrgUsageRowView(row()).recorded.none).toBe(NO_RECORDED_METERS)
    expect(staffOrgUsageRowView(row({ recorded: { emailSends: 3 } })).recorded.none).toBe('')
  })
})
