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
  CRM_CLIENT_SEARCH_FIELDS,
  CRM_CLIENT_SORT_FIELDS,
  CRM_DEAL_CONTACT_ROLE_LIST_FIELDS,
  crmClientListFieldChanges,
} from './crm-list-query'

const FIELDS = [
  ...CRM_CLIENT_SEARCH_FIELDS,
  ...CRM_CLIENT_SORT_FIELDS,
  ...CRM_DEAL_CONTACT_ROLE_LIST_FIELDS,
]

const ROW = {
  title: 'Roaster',
  visibleTo: ['org'],
  amountCents: 5000,
  expectedCloseAtMs: 1_800_000_000_000,
  contactId: 'c1',
  contactRoles: [{ contactId: 'c1', primary: true }],
}

describe('the list fields an edit moves (AGL-4132)', () => {
  it('is empty for an edit no list field is computed from', () => {
    expect(crmClientListFieldChanges('deals', ROW, { nextStep: 'Call' }, FIELDS)).toEqual({})
  })

  it('stamps what the edit moved and nothing beside it', () => {
    expect(crmClientListFieldChanges('deals', ROW, { amountCents: 7500 }, FIELDS)).toEqual({
      amountSortCents: 7500,
    })
  })

  it('reads a removed field as gone', () => {
    expect(
      crmClientListFieldChanges('deals', ROW, { expectedCloseAtMs: null }, FIELDS),
    ).toHaveProperty('expectedCloseSortAtMs')
  })

  it('leaves a field alone that an old read holds differently from the server', () => {
    const old = { ...ROW, amountSortCents: 1, contactRoleContactIds: ['someone-else'] }
    const moved = crmClientListFieldChanges('deals', old, { title: 'Espresso' }, FIELDS)
    expect(moved).toHaveProperty('titleLower', 'espresso')
    expect(moved).not.toHaveProperty('amountSortCents')
    expect(moved).not.toHaveProperty('contactRoleContactIds')
  })
})
