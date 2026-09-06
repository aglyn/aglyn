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
 * The companies bulk plans (AGL-2621): top-level patches, tags by sentinel,
 * a cleared owner as a deleted field, and the cap reported by name.
 */

jest.mock('firebase/firestore', () => ({
  arrayUnion: (...values: unknown[]) => ({ op: 'union', values }),
  arrayRemove: (...values: unknown[]) => ({ op: 'remove', values }),
  deleteField: () => ({ op: 'delete' }),
}))

import {
  COMPANY_TAGS_CAP,
  planCompanyAddTag,
  planCompanyRemoveTag,
  planCompanySetOwner,
} from './companies-bulk-writes'

const NOW = Date.UTC(2026, 8, 5)
const rows = [
  { $id: 'c1', name: 'Acme', tags: ['west'] },
  { $id: 'c2', name: 'Globex', tags: ['vip', 'west'] },
  { $id: 'c3', tags: Array.from({ length: COMPANY_TAGS_CAP }, (_, i) => `t${i}`) },
]

describe('adding a tag', () => {
  it('unions the tag into every row that lacks it, and names the one at the cap', () => {
    const plan = planCompanyAddTag(rows, 'vip', NOW)
    expect(plan.writes).toEqual([
      {
        id: 'c1',
        label: 'Acme',
        kind: 'update',
        data: { tags: { op: 'union', values: ['vip'] }, updatedAt: new Date(NOW) },
      },
    ])
    expect(plan.skipped).toEqual([
      { label: 'c3', reason: `already has ${COMPANY_TAGS_CAP} tags` },
    ])
  })
})

describe('removing a tag', () => {
  it('removes from the rows that carry it, and only those', () => {
    const plan = planCompanyRemoveTag(rows, 'west', NOW)
    expect(plan.writes.map((write) => write.id)).toEqual(['c1', 'c2'])
    expect(plan.writes[0]).toMatchObject({
      kind: 'update',
      data: { tags: { op: 'remove', values: ['west'] } },
    })
    expect(plan.skipped).toEqual([])
  })
})

describe('setting the owner', () => {
  it('writes the uid, and deletes the field for nobody', () => {
    expect(planCompanySetOwner(rows.slice(0, 1), 'uid-1', NOW).writes[0]).toMatchObject({
      id: 'c1',
      label: 'Acme',
      data: { ownerUid: 'uid-1' },
    })
    expect(planCompanySetOwner(rows.slice(0, 1), null, NOW).writes[0]).toMatchObject({
      data: { ownerUid: { op: 'delete' } },
    })
  })
})
