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
 * WHICH ROWS A BULK ACTION REACHES, AND WHAT IT SAYS ABOUT A ROW IT COULD
 * NOT (AGL-2603, AGL-2804).
 *
 * The properties a second copy of this would get wrong: a row with nothing
 * to change is left out silently and a row that cannot be reached is named;
 * the tag cap is the record page's; a detach is the record page's detach,
 * per row; and a batch that fails is retried row by row so the refused
 * address is named rather than counted.
 */

import {
  CONTACT_BULK_WRITE_CHUNK,
  CONTACT_TAGS_CAP,
  normalizeBulkTag,
  planAddTag,
  planDetach,
  planRemoveTag,
  planSetCompany,
  runContactBulkWrites,
  type ContactBulkWrite,
} from './contacts-bulk-writes'

/*
 * The sentinels as inspectable values. Real ones are opaque objects the
 * store interprets; here each says what it is so an assertion can read it.
 */
jest.mock('firebase/firestore', () => ({
  arrayRemove: (...values: unknown[]) => ({ op: 'remove', values }),
  deleteField: () => ({ op: 'delete' }),
}))

const NOW = Date.UTC(2026, 8, 5)
const GROUP = 'group-1'

const rows = [
  { $id: 'c1', email: 'a@example.com', tags: ['vip'], visibleTo: ['host:h1'] },
  { $id: 'c2', email: 'b@example.com', tags: [], visibleTo: ['host:h1', 'host:h9'] },
]
const ids = (selection: { rows: Array<{ $id: string }> }) =>
  selection.rows.map((row) => row.$id)

describe('a tag, normalized the way the record page stores one', () => {
  it('lowercases and trims, and refuses a blank', () => {
    expect(normalizeBulkTag('  VIP ')).toBe('vip')
    expect(normalizeBulkTag('   ')).toBeNull()
  })
})

describe('adding a tag', () => {
  it('reaches every row that lacks it', () => {
    expect(ids(planAddTag(rows, 'wholesale'))).toEqual(['c1', 'c2'])
  })

  it('leaves a row that already carries the tag out, silently', () => {
    const selection = planAddTag(rows, 'vip')
    expect(ids(selection)).toEqual(['c2'])
    expect(selection.skipped).toEqual([])
  })

  it('names a row already at the record page’s cap rather than slipping past it', () => {
    const full = {
      $id: 'c3',
      email: 'full@example.com',
      tags: Array.from({ length: CONTACT_TAGS_CAP }, (_, i) => `t${i}`),
    }
    const selection = planAddTag([full], 'one-more')
    expect(selection.rows).toEqual([])
    expect(selection.skipped).toEqual([
      { email: 'full@example.com', reason: `already has ${CONTACT_TAGS_CAP} tags` },
    ])
  })
})

describe('removing a tag', () => {
  it('reaches the rows that carry it, and only those', () => {
    expect(ids(planRemoveTag(rows, 'vip'))).toEqual(['c1'])
  })
})

/**
 * Filing the selection under one company (AGL-2613): the rows whose link
 * would change, and a row whose link state the table could not project
 * named rather than guessed at.
 */
describe('setting the company', () => {
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

  it('reaches the rows not already at the company', () => {
    const selection = planSetCompany(linked, 'c-acme')
    // c2 is already at Acme and is left out, silently.
    expect(ids(selection)).toEqual(['c1', 'c3'])
    expect(selection.skipped).toEqual([])
  })

  it('unlinks the rows that have a company, with an empty choice', () => {
    expect(ids(planSetCompany(linked, null))).toEqual(['c2', 'c3'])
  })

  it('names a row whose link state the table could not project, rather than guessing', () => {
    const selection = planSetCompany([{ $id: 'c9', email: 'z@example.com' }], 'c-acme')
    expect(selection.rows).toEqual([])
    expect(selection.skipped).toEqual([
      { email: 'z@example.com', reason: 'its company link could not be read' },
    ])
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
