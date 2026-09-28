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
 * The notifications feed's filters are equalities its indexes serve
 * (AGL-3321).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { planNotificationFilters } from './notification-filters'

const notificationFilterWheres = (
  clauses: Parameters<typeof planNotificationFilters>[0],
) => planNotificationFilters(clauses).wheres

describe('planNotificationFilters', () => {
  it('serves Type and Status together, by equality on the stored fields', () => {
    expect(
      notificationFilterWheres([
        { field: 'type', op: 'equals', value: 'billing.invoice' },
        { field: 'readAt', op: 'equals', value: 'false' },
      ]),
    ).toEqual([
      ['type', '==', 'billing.invoice'],
      ['read', '==', false],
    ])
  })

  it('serves up to thirty types as one `in`', () => {
    const thirty = Array.from({ length: 30 }, (_unused, at) => `t${at}`)
    const plan = planNotificationFilters([
      { field: 'type', op: 'isAnyOf', value: thirty.join(',') },
    ])
    expect(plan.wheres).toEqual([['type', 'in', thirty]])
    expect(plan.refused).toEqual([])
  })

  it('refuses a pick of more than thirty types by name, not a silent cut', () => {
    const many = {
      field: 'type',
      op: 'isAnyOf',
      value: Array.from({ length: 31 }, (_unused, at) => `t${at}`).join(','),
    } as const
    const status = { field: 'readAt', op: 'equals', value: 'false' } as const
    const plan = planNotificationFilters([many, status])
    expect(plan.wheres).toEqual([['read', '==', false]])
    expect(plan.refused).toEqual([
      { clause: many, reason: 'at most 30 values' },
    ])
  })

  it('ignores a clause it cannot serve rather than guessing', () => {
    expect(
      notificationFilterWheres([
        { field: 'readAt', op: 'equals', value: 'maybe' },
        { field: 'title', op: 'contains', value: 'invoice' },
        { field: 'type', op: 'isAnyOf', value: '' },
      ]),
    ).toEqual([])
  })

  it('every combination it builds has its composite index', () => {
    const indexes = JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'),
        'utf8',
      ),
    ).indexes as Array<{ collectionGroup: string; fields: Array<{ fieldPath: string; order?: string }> }>
    const shapes = indexes
      .filter((index) => index.collectionGroup === 'notifications')
      .map((index) => index.fields.map((field) => `${field.fieldPath}:${field.order}`).join(','))
    expect(shapes).toEqual(
      expect.arrayContaining([
        'type:ASCENDING,createdAt:DESCENDING',
        'read:ASCENDING,createdAt:DESCENDING',
        'type:ASCENDING,read:ASCENDING,createdAt:DESCENDING',
      ]),
    )
  })
})
