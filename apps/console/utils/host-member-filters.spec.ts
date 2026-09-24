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
 * A site's collaborator roster filters by Site access and searches by
 * address, both served by its query beneath the email order (AGL-3321).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hostMemberEmailRange, hostMemberFilterWheres } from './host-member-filters'

describe('hostMemberFilterWheres', () => {
  it('serves one role as an equality on the stored field', () => {
    expect(hostMemberFilterWheres([{ field: 'role', op: 'equals', value: 'author' }])).toEqual([
      ['role', '==', 'author'],
    ])
  })

  it('serves several roles as `in`, capped at thirty', () => {
    expect(
      hostMemberFilterWheres([{ field: 'role', op: 'isAnyOf', value: 'viewer, admin' }]),
    ).toEqual([['role', 'in', ['viewer', 'admin']]])
    const many = Array.from({ length: 40 }, (_unused, at) => `r${at}`).join(',')
    const [where] = hostMemberFilterWheres([{ field: 'role', op: 'isAnyOf', value: many }])
    expect(where[2]).toHaveLength(30)
  })

  it('ignores a clause it cannot serve rather than guessing', () => {
    expect(
      hostMemberFilterWheres([
        { field: 'role', op: 'doesNotEqual', value: 'admin' },
        { field: 'status', op: 'equals', value: 'invited' },
        { field: 'role', op: 'isAnyOf', value: '' },
      ]),
    ).toEqual([])
  })
})

describe('hostMemberEmailRange', () => {
  it('is a prefix of the stored, lower-cased address', () => {
    expect(hostMemberEmailRange(['Ann@'])).toEqual({ start: 'ann@', end: 'ann@' })
  })

  it('is no range at all for an empty search', () => {
    expect(hostMemberEmailRange([])).toBeNull()
    expect(hostMemberEmailRange(['  '])).toBeNull()
  })
})

describe('the roster query has its index', () => {
  it('a role beneath the email order reads `members: role, email`', () => {
    const indexes = JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'),
        'utf8',
      ),
    ).indexes as Array<{
      collectionGroup: string
      queryScope: string
      fields: Array<{ fieldPath: string; order?: string }>
    }>
    const shapes = indexes
      .filter((index) => index.collectionGroup === 'members' && index.queryScope === 'COLLECTION')
      .map((index) => index.fields.map((field) => `${field.fieldPath}:${field.order}`).join(','))
    expect(shapes).toContain('role:ASCENDING,email:ASCENDING')
  })
})
