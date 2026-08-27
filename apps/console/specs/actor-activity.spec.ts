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

/** Every document the fake collection group holds, newest first. */
interface FakeDoc {
  id: string
  parent: string
  data: Record<string, unknown>
}

// `mock`-prefixed so the factory below may close over them: jest allows
// only that prefix out of scope, as a guard against uninitialized mocks.
let mockCorpus: FakeDoc[] = []
let mockHostsInOrg: string[] = []

const snapshotFor = (docs: FakeDoc[]) => ({
  empty: docs.length === 0,
  docs: docs.map((entry) => ({
    id: entry.id,
    data: () => entry.data,
    ref: {
      path: `${entry.parent}/activity/${entry.id}`,
      parent: { parent: { path: entry.parent } },
    },
  })),
})

jest.mock('@aglyn/tenant-data-admin', () => {
  const build = (state: { after?: string | null; limit: number }) => ({
    where: () => build(state),
    orderBy: () => build(state),
    startAfter: (doc: { ref: { path: string } }) =>
      build({ ...state, after: doc.ref.path }),
    limit: (value: number) => build({ ...state, limit: value }),
    get: async () => {
      const index = state.after
        ? mockCorpus.findIndex(
            (entry) => `${entry.parent}/activity/${entry.id}` === state.after,
          ) + 1
        : 0
      return snapshotFor(mockCorpus.slice(index, index + state.limit))
    },
  })
  return {
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collectionGroup: () => build({ limit: 25 }),
          doc: (path: string) => ({
            get: async () => {
              const found = mockCorpus.find(
                (entry) => `${entry.parent}/activity/${entry.id}` === path,
              )
              return {
                exists: Boolean(found),
                ref: { path },
              }
            },
          }),
          collection: () => ({
            where: () => ({
              select: () => ({
                get: async () => ({
                  docs: mockHostsInOrg.map((id) => ({ id })),
                }),
              }),
            }),
          }),
        }),
      }),
    },
  }
})

import {
  orgActivityScopePaths,
  readActorActivity,
} from '../utils/server/actor-activity'

const doc = (id: string, parent: string, seconds = 1000): FakeDoc => ({
  id,
  parent,
  data: {
    actorId: 'u1',
    action: 'Saved the screen',
    target: { type: 'screen', name: `S${id}` },
    createdAt: { seconds },
  },
})

beforeEach(() => {
  mockCorpus = []
  mockHostsInOrg = []
})

describe('readActorActivity (AGL-1488)', () => {
  it('answers with the actor entries, newest first, flattened for the client', async () => {
    mockCorpus = [doc('a', 'hosts/h1', 900), doc('b', 'orgs/o1', 800)]
    const page = await readActorActivity({ actorId: 'u1', pageSize: 25 })
    expect(page.entries.map((entry) => entry.$id)).toEqual(['a', 'b'])
    expect(page.entries[0]).toMatchObject({
      scopeType: 'host',
      scopeId: 'h1',
      action: 'Saved the screen',
    })
    expect(page.entries[1]).toMatchObject({ scopeType: 'org', scopeId: 'o1' })
    expect(page.nextCursor).toBeNull()
  })

  it('pages, and the cursor resumes exactly where the page ended', async () => {
    mockCorpus = Array.from({ length: 7 }, (_, i) =>
      doc(`d${i}`, 'hosts/h1', 1000 - i),
    )
    const first = await readActorActivity({ actorId: 'u1', pageSize: 3 })
    expect(first.entries.map((e) => e.$id)).toEqual(['d0', 'd1', 'd2'])
    expect(first.nextCursor).toBe('hosts/h1/activity/d2')

    const second = await readActorActivity({
      actorId: 'u1',
      pageSize: 3,
      cursor: first.nextCursor,
    })
    expect(second.entries.map((e) => e.$id)).toEqual(['d3', 'd4', 'd5'])
  })

  /**
   * The quiet half of an off-by-one in an audit log: a row read to fill the
   * batch but not shown, whose absence nobody looks for.
   */
  it('never skips an entry across a page boundary', async () => {
    mockCorpus = Array.from({ length: 10 }, (_, i) =>
      doc(`d${i}`, 'hosts/h1', 1000 - i),
    )
    const seen: string[] = []
    let cursor: string | null = null
    for (let page = 0; page < 5; page += 1) {
      const result: Awaited<ReturnType<typeof readActorActivity>> =
        await readActorActivity({ actorId: 'u1', pageSize: 3, cursor })
      seen.push(...result.entries.map((entry) => entry.$id))
      cursor = result.nextCursor
      if (!cursor) break
    }
    expect(seen).toEqual(mockCorpus.map((entry) => entry.id))
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('stops offering a next page when the query runs out', async () => {
    mockCorpus = [doc('a', 'hosts/h1')]
    const page = await readActorActivity({ actorId: 'u1', pageSize: 3 })
    expect(page.nextCursor).toBeNull()
  })

  describe('scoped to one organization', () => {
    it('keeps only what happened inside it', async () => {
      mockCorpus = [
        doc('a', 'hosts/mine', 900),
        doc('b', 'hosts/theirs', 800),
        doc('c', 'orgs/mine-org', 700),
        doc('d', 'orgs/other-org', 600),
      ]
      const page = await readActorActivity({
        actorId: 'u1',
        pageSize: 25,
        scopePaths: new Set(['hosts/mine', 'orgs/mine-org']),
      })
      expect(page.entries.map((entry) => entry.$id)).toEqual(['a', 'c'])
      // The filtered-out rows were still READ, which is the number that says
      // whether the filter has stopped being affordable.
      expect(page.scanned).toBe(4)
    })

    it('answers empty for a scope with nothing in it, without querying', async () => {
      mockCorpus = [doc('a', 'hosts/h1')]
      const page = await readActorActivity({
        actorId: 'u1',
        pageSize: 25,
        scopePaths: new Set<string>(),
      })
      expect(page).toEqual({ entries: [], nextCursor: null, scanned: 0 })
    })
  })

  it('answers empty for no actor rather than reading everything', async () => {
    mockCorpus = [doc('a', 'hosts/h1')]
    const page = await readActorActivity({ actorId: '', pageSize: 25 })
    expect(page.entries).toEqual([])
    expect(page.scanned).toBe(0)
  })
})

describe('orgActivityScopePaths', () => {
  it('is the org itself plus every site it owns', async () => {
    mockHostsInOrg = ['h1', 'h2']
    expect([...(await orgActivityScopePaths('o1'))].sort()).toEqual([
      'hosts/h1',
      'hosts/h2',
      'orgs/o1',
    ])
  })

  // An org with no sites still has its own feed.
  it('is never empty', async () => {
    mockHostsInOrg = []
    expect([...(await orgActivityScopePaths('o1'))]).toEqual(['orgs/o1'])
  })
})
