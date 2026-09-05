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
  CRM_LEAD_OPEN_STATUSES,
  CRM_LEAD_STATUS_LABELS,
  CRM_LEAD_STATUSES,
  crmLeadStatus,
  isCrmLeadOpen,
  isCrmLeadStatus,
} from './crm'

/**
 * The lead working state (AGL-2608): a status the list filters on, and the
 * reading of a lead that has never been given one.
 */
describe('lead statuses', () => {
  it('labels every status', () => {
    for (const status of CRM_LEAD_STATUSES) {
      expect(CRM_LEAD_STATUS_LABELS[status]).toBeTruthy()
    }
  })

  it('recognizes only the four statuses', () => {
    expect(isCrmLeadStatus('working')).toBe(true)
    expect(isCrmLeadStatus('converted')).toBe(false)
    expect(isCrmLeadStatus(undefined)).toBe(false)
  })

  /**
   * Every lead the capture door writes carries no status, and so does every
   * lead captured before the CRM existed. Reading that as `new` is what makes
   * the section list them on the day it ships.
   */
  it('reads an absent or unknown status as new', () => {
    expect(crmLeadStatus(undefined)).toBe('new')
    expect(crmLeadStatus({})).toBe('new')
    expect(crmLeadStatus({ status: 'archived' as never })).toBe('new')
    expect(crmLeadStatus({ status: 'unqualified' })).toBe('unqualified')
  })

  it('treats new and working as open, and the two closed states as not', () => {
    expect(CRM_LEAD_OPEN_STATUSES).toEqual(['new', 'working'])
    expect(isCrmLeadOpen({})).toBe(true)
    expect(isCrmLeadOpen({ status: 'working' })).toBe(true)
    expect(isCrmLeadOpen({ status: 'qualified' })).toBe(false)
    expect(isCrmLeadOpen({ status: 'unqualified' })).toBe(false)
  })
})
