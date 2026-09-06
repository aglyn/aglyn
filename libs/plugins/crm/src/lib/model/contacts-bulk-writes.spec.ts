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
 * WHAT A BULK ACTION WRITES, AND WHAT IT SAYS ABOUT A ROW IT COULD NOT
 * (AGL-2603).
 *
 * The properties a second copy of this would get wrong: every patch is a
 * dotted path into THIS holder's facet; a batch that fails is retried row by
 * row so the refused address is named rather than counted; the tag cap is
 * the drawer's; a detach is the drawer's detach, per row.
 */

import {
  companyCountDeltas,
  CONTACT_BULK_WRITE_CHUNK,
  CONTACT_TAGS_CAP,
  normalizeBulkTag,
  planAddTag,
  planDetach,
  planRemoveTag,
  planSetCompany,
  planSetFacetField,
  runContactBulkWrites,
  type ContactBulkWrite,
} from './contacts-bulk-writes'

/*
 * The sentinels as inspectable values. Real ones are opaque objects the
 * store interprets; here each says what it is so an assertion can read it.
 */
jest.mock('firebase/firestore', () => ({
  arrayUnion: (...values: unknown[]) => ({ op: 'union', values }),
  arrayRemove: (...values: unknown[]) => ({ op: 'remove', values }),
  deleteField: () => ({ op: 'delete' }),
  increment: (by: number) => ({ op: 'increment', by }),
  serverTimestamp: () => ({ op: 'serverTimestamp' }),
}))

const NOW = Date.UTC(2026, 8, 5)
const GROUP = 'group-1'

const rows = [
  { $id: 'c1', email: 'a@example.com', tags: ['vip'], visibleTo: ['host:h1'] },
  { $id: 'c2', email: 'b@example.com', tags: [], visibleTo: ['host:h1', 'host:h9'] },
]

describe('a tag, normalized the way the drawer stores one', () => {
  it('lowercases and trims, and refuses a blank', () => {
    expect(normalizeBulkTag('  VIP ')).toBe('vip')
    expect(normalizeBulkTag('   ')).toBeNull()
  })
})

describe('adding a tag', () => {
  it('unions the tag into THIS holder’s facet on every row that lacks it', () => {
    const plan = planAddTag(rows, GROUP, 'wholesale', NOW)
    expect(plan.writes.map((write) => write.id)).toEqual(['c1', 'c2'])
    expect(plan.writes[0]).toMatchObject({
      kind: 'update',
      email: 'a@example.com',
      data: {
        'facets.group-1.tags': { op: 'union', values: ['wholesale'] },
        updatedAt: new Date(NOW),
      },
    })
  })

  it('leaves a row that already carries the tag alone, silently', () => {
    const plan = planAddTag(rows, GROUP, 'vip', NOW)
    expect(plan.writes.map((write) => write.id)).toEqual(['c2'])
    expect(plan.skipped).toEqual([])
  })

  it('reports a row already at the drawer’s cap rather than slipping past it', () => {
    const full = {
      $id: 'c3',
      email: 'full@example.com',
      tags: Array.from({ length: CONTACT_TAGS_CAP }, (_, i) => `t${i}`),
    }
    const plan = planAddTag([full], GROUP, 'one-more', NOW)
    expect(plan.writes).toEqual([])
    expect(plan.skipped).toEqual([
      { email: 'full@example.com', reason: `already has ${CONTACT_TAGS_CAP} tags` },
    ])
  })
})

describe('removing a tag', () => {
  it('removes from the facet of every row that has it, and only those', () => {
    const plan = planRemoveTag(rows, GROUP, 'vip', NOW)
    expect(plan.writes).toHaveLength(1)
    expect(plan.writes[0]).toMatchObject({
      id: 'c1',
      data: { 'facets.group-1.tags': { op: 'remove', values: ['vip'] } },
    })
  })
})

describe('setting the owner or the stage', () => {
  it('writes the scalar into the facet', () => {
    const plan = planSetFacetField(rows, GROUP, 'lifecycleStage', 'customer', NOW)
    expect(plan.writes.map((write) => (write as any).data['facets.group-1.lifecycleStage'])).toEqual([
      'customer',
      'customer',
    ])
  })

  it('clears an owner rather than writing an empty string', () => {
    // The audience matcher reads "no owner" as absent; `''` would be a
    // value nobody owns and no filter names.
    const plan = planSetFacetField(rows, GROUP, 'ownerUid', null, NOW)
    expect((plan.writes[0] as any).data['facets.group-1.ownerUid']).toEqual({ op: 'delete' })
  })
})

/**
 * Filing the selection under one company (AGL-2613): the record page's link
 * write per row, with the count deltas riding as numbers so a batch can sum
 * them and a per-row retry can apply one row's share.
 */
describe('setting the company', () => {
  const ACME = { id: 'c-acme', name: 'Acme', domain: 'acme.com' }
  const linked = [
    {
      $id: 'c1',
      email: 'a@example.com',
      companyLink: { companyId: null, companyIds: [], heldElsewhere: [] },
    },
    {
      $id: 'c2',
      email: 'b@example.com',
      companyLink: { companyId: 'c-acme', companyIds: ['c-acme'], heldElsewhere: [] },
    },
    {
      $id: 'c3',
      email: 'c@example.com',
      companyLink: { companyId: 'c-globex', companyIds: ['c-globex'], heldElsewhere: [] },
    },
  ]

  it('links each row through the facet and the mirror, echoing the name, with its count delta', () => {
    const plan = planSetCompany(linked, GROUP, ACME, NOW)
    // c2 is already at Acme and is left alone, silently.
    expect(plan.writes.map((write) => write.id)).toEqual(['c1', 'c3'])
    expect(plan.skipped).toEqual([])
    expect(plan.writes[0]).toEqual({
      id: 'c1',
      email: 'a@example.com',
      kind: 'update',
      data: {
        'facets.group-1.companyId': 'c-acme',
        'facets.group-1.companyName': 'Acme',
        companyName: 'Acme',
        companyIds: { op: 'union', values: ['c-acme'] },
        updatedAt: new Date(NOW),
      },
      companyCounts: [{ companyId: 'c-acme', delta: 1 }],
    })
    // c3 MOVES: the old company loses one and the new one gains one.
    expect((plan.writes[1] as any).companyCounts).toEqual([
      { companyId: 'c-globex', delta: -1 },
      { companyId: 'c-acme', delta: 1 },
    ])
  })

  it('unlinks with an empty choice, clearing the name', () => {
    const plan = planSetCompany(linked, GROUP, null, NOW)
    expect(plan.writes.map((write) => write.id)).toEqual(['c2', 'c3'])
    expect((plan.writes[0] as any).data).toMatchObject({
      'facets.group-1.companyId': { op: 'delete' },
      companyName: { op: 'delete' },
      companyIds: { op: 'remove', values: ['c-acme'] },
    })
  })

  it('names a row whose link state the table could not project, rather than guessing', () => {
    const plan = planSetCompany([{ $id: 'c9', email: 'z@example.com' }], GROUP, ACME, NOW)
    expect(plan.writes).toEqual([])
    expect(plan.skipped).toEqual([
      { email: 'z@example.com', reason: 'its company link could not be read' },
    ])
  })

  it('sums the deltas per company across a batch, dropping the ones that cancel', () => {
    const plan = planSetCompany(linked, GROUP, ACME, NOW)
    expect([...companyCountDeltas(plan.writes)]).toEqual([
      ['c-acme', 2],
      ['c-globex', -1],
    ])
    // One row moved to Acme and another moved away: Acme's count is untouched.
    const cancelling: ContactBulkWrite[] = [
      { id: 'x', email: 'x', kind: 'update', data: {}, companyCounts: [{ companyId: 'c-acme', delta: 1 }] },
      { id: 'y', email: 'y', kind: 'update', data: {}, companyCounts: [{ companyId: 'c-acme', delta: -1 }] },
      { id: 'z', email: 'z', kind: 'delete' },
    ]
    expect(companyCountDeltas(cancelling).size).toBe(0)
  })
})

describe('letting the rows go', () => {
  it('deletes a row this holder alone holds, and detaches from a shared one', () => {
    const plan = planDetach(rows, { groupId: GROUP, hostIds: ['h1'] }, NOW)
    expect(plan.writes[0]).toEqual({ id: 'c1', email: 'a@example.com', kind: 'delete' })
    expect(plan.writes[1]).toMatchObject({
      id: 'c2',
      kind: 'update',
      data: {
        'facets.group-1': { op: 'delete' },
        'marketingConsentByHost.h1': { op: 'delete' },
        visibleTo: { op: 'remove', values: ['host:h1'] },
        capturedByHostIds: { op: 'remove', values: ['h1'] },
      },
    })
  })
})

describe('applying the writes', () => {
  const write = (i: number): ContactBulkWrite => ({
    id: `c${i}`,
    email: `p${i}@example.com`,
    kind: 'update',
    data: {},
  })

  it('commits in chunks of the batch size', async () => {
    const batches: number[] = []
    const outcome = await runContactBulkWrites(
      {
        commitBatch: async (chunk) => void batches.push(chunk.length),
        commitOne: async () => undefined,
      },
      Array.from({ length: CONTACT_BULK_WRITE_CHUNK + 1 }, (_, i) => write(i)),
    )
    expect(batches).toEqual([CONTACT_BULK_WRITE_CHUNK, 1])
    expect(outcome).toEqual({ done: CONTACT_BULK_WRITE_CHUNK + 1, refused: [] })
  })

  it('names the refused row by address after a batch fails, and keeps the rest', async () => {
    const singles: string[] = []
    const outcome = await runContactBulkWrites(
      {
        commitBatch: async () => {
          throw Object.assign(new Error('denied'), { code: 'permission-denied' })
        },
        commitOne: async (one) => {
          singles.push(one.id)
          if (one.id === 'c1') {
            throw Object.assign(new Error('denied'), { code: 'permission-denied' })
          }
        },
      },
      [write(0), write(1), write(2)],
    )
    // Every row of the failed chunk was tried on its own.
    expect(singles).toEqual(['c0', 'c1', 'c2'])
    expect(outcome).toEqual({
      done: 2,
      refused: [{ email: 'p1@example.com', error: 'not permitted' }],
    })
  })

  it('pays the per-row pass only for the chunk that failed', async () => {
    let batch = 0
    const singles: string[] = []
    await runContactBulkWrites(
      {
        commitBatch: async () => {
          batch += 1
          if (batch === 1) throw new Error('boom')
        },
        commitOne: async (one) => void singles.push(one.id),
      },
      [write(0), write(1), write(2), write(3)],
      2,
    )
    expect(singles).toEqual(['c0', 'c1'])
  })
})
