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

import { crmPicklistKey, dealContactRolesWithPrimary, effectiveCrmPicklist } from '@aglyn/aglyn'
import {
  companyContactRolesOf,
  companyContactRolesSave,
  dealContactRoleAddProblem,
} from '../model/deal-contact-roles'

/** Salesforce's Account Contact Roles: the model the company's card saves through (AGL-4122). */
describe('a company’s contact roles', () => {
  const picklist = effectiveCrmPicklist('opportunityContactRole', null)
  const role = picklist.values[0].label

  it('saves the people, their parts and the Primary', () => {
    const verdict = companyContactRolesSave(
      {},
      [{ contactId: 'jordan', role, primary: true }, { contactId: 'pat', primary: false }],
      picklist,
    )
    expect(verdict).toEqual({
      ok: true,
      contactRoles: [
        { contactId: 'jordan', role, primary: true },
        { contactId: 'pat', primary: false },
      ],
      contactRoleContactIds: ['jordan', 'pat'],
      contactRoleKeys: [crmPicklistKey(role)],
    })
  })

  it('reads the Primary off the row, because a company has no contactId', () => {
    const roles = companyContactRolesOf({
      contactRoles: [
        { contactId: 'jordan', role, primary: true },
        { contactId: 'pat', primary: false },
      ],
    })
    expect(roles.map((row) => row.primary)).toEqual([true, false])
  })

  it('moves the Primary, and only one person holds it', () => {
    const next = dealContactRolesWithPrimary(
      [
        { contactId: 'jordan', primary: true },
        { contactId: 'pat', primary: false },
      ],
      'pat',
    )
    expect(next.filter((row) => row.primary).map((row) => row.contactId)).toEqual(['pat'])
  })

  it('refuses a role that is not on the org’s list', () => {
    const verdict = companyContactRolesSave(
      {},
      [{ contactId: 'jordan', role: 'Not a role', primary: true }],
      picklist,
    )
    expect(verdict.ok).toBe(false)
  })

  it('keeps a role the org has since retired, on the contact who holds it', () => {
    const stored = { contactRoles: [{ contactId: 'jordan', role: 'Old role', primary: true }] }
    const verdict = companyContactRolesSave(
      stored,
      [{ contactId: 'jordan', role: 'Old role', primary: true }],
      picklist,
    )
    expect(verdict.ok).toBe(true)
  })

  it('names the company, not a deal, when a contact is already on it', () => {
    expect(
      dealContactRoleAddProblem([{ contactId: 'jordan', primary: true }], 'jordan', 'company'),
    ).toBe('That contact is already on this company.')
  })
})
