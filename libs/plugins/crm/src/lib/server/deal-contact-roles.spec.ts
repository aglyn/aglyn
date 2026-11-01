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

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'now' },
}))

import { companyContactRolesUpdate, sweepDealContactRoles } from './deal-contact-roles'

const ROLES = [
  { contactId: 'jordan', role: 'Decision Maker', primary: true },
  { contactId: 'pat', role: 'Evaluator', primary: false },
]

describe('a company’s contact roles when a person leaves', () => {
  it('moves the row to a merge’s survivor', () => {
    expect(companyContactRolesUpdate({ contactRoles: ROLES }, 'jordan', 'sam')).toEqual({
      contactRoles: [
        { contactId: 'sam', role: 'Decision Maker', primary: true },
        { contactId: 'pat', role: 'Evaluator', primary: false },
      ],
      contactRoleContactIds: ['sam', 'pat'],
      contactRoleKeys: ['decision maker', 'evaluator'],
      updatedAt: 'now',
    })
  })

  it('takes the row off for a delete or an erasure', () => {
    const update = companyContactRolesUpdate({ contactRoles: ROLES }, 'pat', null)
    expect(update['contactRoles']).toEqual([ROLES[0]])
    expect(update['contactRoleContactIds']).toEqual(['jordan'])
  })

  it('reaches the org’s companies from the deals sweep', async () => {
    const committed: unknown[] = []
    const emptyPage = { empty: true, docs: [], size: 0 }
    const company = {
      ref: 'company-ref',
      data: () => ({ contactRoles: ROLES }),
    }
    const companies = {
      where: (field: string, op: string, value: string) => {
        expect([field, op, value]).toEqual(['contactRoleContactIds', 'array-contains', 'pat'])
        return {
          limit: () => ({ get: async () => ({ empty: false, docs: [company], size: 1 }) }),
        }
      },
    }
    const deals = {
      parent: { collection: () => companies },
      where: () => ({ limit: () => ({ get: async () => emptyPage }) }),
    }
    const firestore = {
      batch: () => ({
        update: (_ref: unknown, update: unknown) => committed.push(update),
        commit: async () => undefined,
      }),
    }
    await sweepDealContactRoles(firestore as never, deals as never, 'pat', null, 'test')
    expect(committed).toHaveLength(1)
  })
})
