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
 *
 * @jest-environment node
 */

/**
 * The list-member resource's key, spelled out so the list's page names it
 * without loading the transfer core, is the core's instance key.
 */

import {
  matchHeaders,
  parseTransferResourceKey,
  transferResourceInstanceKey,
} from '@aglyn/aglyn/data-transfer'
import {
  LIST_MEMBER_ALIASES,
  LIST_MEMBERS_RESOURCE,
  contactFieldId,
  listIdOfResourceKey,
  listMemberCatalog,
  listMembersResourceKey,
} from './email-transfer-catalog'

describe('the key one list’s members move under', () => {
  it('is the core’s instance key, and reads back to the list', () => {
    expect(listMembersResourceKey('list-1')).toBe(transferResourceInstanceKey(LIST_MEMBERS_RESOURCE, 'list-1'))
    expect(parseTransferResourceKey(listMembersResourceKey('list-1'))).toEqual({
      key: LIST_MEMBERS_RESOURCE,
      instance: 'list-1',
    })
    expect(listIdOfResourceKey(listMembersResourceKey('list-1'))).toBe('list-1')
  })

  it('names no list for another resource, or an id a key cannot carry', () => {
    expect(listIdOfResourceKey('email.suppressions')).toBeNull()
    expect(listIdOfResourceKey(LIST_MEMBERS_RESOURCE)).toBeNull()
    expect(listIdOfResourceKey(`${LIST_MEMBERS_RESOURCE}:a/b`)).toBeNull()
  })
})

/*
 * A store's customer file (AGL-4245): its address and contact columns map
 * themselves; its marketing column is left for the Permission step.
 */
describe('a store’s customer file', () => {
  const fields = listMemberCatalog().standard
  const mapped = (headers: string[]) => {
    const { mapping } = matchHeaders(headers, fields, { dictionaries: LIST_MEMBER_ALIASES })
    return Object.fromEntries(Object.entries(mapping).map(([column, fieldId]) => [headers[Number(column)], fieldId]))
  }

  it('maps a Shopify customers export', () => {
    const out = mapped(['Customer ID', 'First Name', 'Last Name', 'Email', 'Accepts Email Marketing', 'Default Address Company', 'Phone', 'Tags'])
    expect(out).toMatchObject({
      Email: 'email',
      'First Name': contactFieldId('firstName'),
      'Last Name': contactFieldId('lastName'),
      Phone: contactFieldId('phone'),
      'Default Address Company': contactFieldId('companyName'),
    })
    expect(Object.values(out)).not.toContain('consent')
  })

  it('maps a Wix contacts export by its first email and phone', () => {
    const out = mapped(['First Name', 'Last Name', 'Email 1', 'Email 2', 'Phone 1', 'Company', 'Position', 'Email subscriber status'])
    expect(out).toMatchObject({
      'Email 1': 'email',
      'Phone 1': contactFieldId('phone'),
      Company: contactFieldId('companyName'),
      Position: contactFieldId('jobTitle'),
    })
  })

  it('maps a Squarespace customers export', () => {
    const out = mapped(['Email', 'First Name', 'Last Name', 'Shipping Phone Number', 'Accepts Marketing', 'Order Count'])
    expect(out).toMatchObject({
      Email: 'email',
      'First Name': contactFieldId('firstName'),
      'Shipping Phone Number': contactFieldId('phone'),
    })
  })
})
