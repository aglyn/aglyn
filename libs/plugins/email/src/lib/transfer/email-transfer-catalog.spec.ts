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
  parseTransferResourceKey,
  transferResourceInstanceKey,
} from '@aglyn/aglyn/data-transfer'
import {
  LIST_MEMBERS_RESOURCE,
  listIdOfResourceKey,
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
