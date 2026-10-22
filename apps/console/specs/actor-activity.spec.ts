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

/** One fake query's shape so far. */
interface MockQueryState {
  after?: string | null
  /** `startAt`: the cursor row itself is the first one read. */
  at?: string | null
  limit: number
  /** Every predicate, as the query was handed it. */
  wheres?: Array<[string, string, unknown]>
}

/** Every query's predicates, as `field op value`, in the order they were added. */
let mockWheres: string[][] = []

jest.mock('@aglyn/tenant-data-admin', () => {
  const holds = (data: Record<string, unknown>, [field, op, value]: [string, string, unknown]) => {
    const stored = data[field]
    if (op === '==') return stored === value
    if (op === 'array-contains') return Array.isArray(stored) && stored.includes(value)
    throw new Error(`unexpected operator ${op}`)
  }
  const build = (state: MockQueryState) => ({
    where: (field: string, op: string, value: unknown) =>
      build({ ...state, wheres: [...(state.wheres ?? []), [field, op, value]] }),
    orderBy: () => build(state),
    startAfter: (doc: { ref: { path: string } }) =>
      build({ ...state, after: doc.ref.path }),
    startAt: (doc: { ref: { path: string } }) =>
      build({ ...state, at: doc.ref.path }),
    limit: (value: number) => build({ ...state, limit: value }),
    get: async () => {
      mockWheres.push(
        (state.wheres ?? []).map(([field, op, value]) => `${field} ${op} ${JSON.stringify(value)}`),
      )
      const matching = mockCorpus.filter((entry) =>
        (state.wheres ?? []).every((where) => holds(entry.data, where)),
      )
      const position = (path: string) =>
        matching.findIndex((entry) => `${entry.parent}/activity/${entry.id}` === path)
      const index = state.after
        ? position(state.after) + 1
        : state.at
          ? position(state.at)
          : 0
      return snapshotFor(matching.slice(index, index + state.limit))
    },
  })
  return {
    firebaseAdmin: {
      // The filter translator names the document id as a sort tie-break.
      firestore: { FieldPath: { documentId: () => '__name__' } },
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

import { activitySearchTokens } from '@aglyn/aglyn/app-utils/activity-search'
import {
  orgActivityScopePaths,
  readActorActivity,
} from '../utils/server/actor-activity'

const doc = (id: string, parent: string, seconds = 1000): FakeDoc => {
  const target = { type: 'screen', name: `S${id}` }
  return {
    id,
    parent,
    data: {
      actorId: 'u1',
      actorEmail: 'ada@example.test',
      action: 'Saved the screen',
      target,
      searchTokens: activitySearchTokens({ actorEmail: 'ada@example.test', target }),
      createdAt: { seconds },
    },
  }
}

beforeEach(() => {
  mockCorpus = []
  mockHostsInOrg = []
  mockWheres = []
})

describe('readActorActivity', () => {
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

  it('pages a FILTERED feed from its cursor, not from the top (AGL-3321)', async () => {
    mockCorpus = Array.from({ length: 10 }, (_, i) => ({
      ...doc(`d${i}`, 'hosts/h1', 1000 - i),
      data: {
        ...doc(`d${i}`, 'hosts/h1', 1000 - i).data,
        action: i % 2 === 0 ? 'Published the screen' : 'Saved the screen',
      },
    }))
    const clauses = [{ field: 'action', op: 'equals', value: 'Published the screen' }]
    const first = await readActorActivity({ actorId: 'u1', pageSize: 2, clauses })
    expect(first.entries.map((e) => e.$id)).toEqual(['d0', 'd2'])
    expect(first.nextCursor).toBe('hosts/h1/activity/d2')

    const second = await readActorActivity({
      actorId: 'u1',
      pageSize: 2,
      clauses,
      cursor: first.nextCursor,
    })
    expect(second.entries.map((e) => e.$id)).toEqual(['d4', 'd6'])
  })

  it('puts the search word on the query beside the person, and reads nothing it discards (AGL-3321)', async () => {
    mockCorpus = [
      doc('a', 'hosts/h1', 900),
      doc('b', 'hosts/h1', 800),
      doc('c', 'orgs/o1', 700),
    ]
    const page = await readActorActivity({ actorId: 'u1', pageSize: 25, search: ['Sb'] })
    expect(page.entries.map((entry) => entry.$id)).toEqual(['b'])
    expect(mockWheres).toEqual([['actorId == "u1"', 'searchTokens array-contains "sb"']])
    expect(page.refused).toEqual([])
  })

  it('says what it could not put on the query, and does not apply it', async () => {
    mockCorpus = [doc('a', 'hosts/h1', 900)]
    const page = await readActorActivity({
      actorId: 'u1',
      pageSize: 25,
      clauses: [{ field: 'target', op: 'equals', value: 'Sa' }],
    })
    expect(page.entries.map((entry) => entry.$id)).toEqual(['a'])
    expect(page.refused).toEqual([
      { clause: { field: 'target', op: 'equals', value: 'Sa' }, reason: expect.any(String) },
    ])
    expect(mockWheres).toEqual([['actorId == "u1"']])
  })

  it('stops offering a next page when the query runs out', async () => {
    mockCorpus = [doc('a', 'hosts/h1')]
    const page = await readActorActivity({ actorId: 'u1', pageSize: 3 })
    expect(page.nextCursor).toBeNull()
  })

  it('answers empty for no actor rather than reading everything', async () => {
    mockCorpus = [doc('a', 'hosts/h1')]
    const page = await readActorActivity({ actorId: '', pageSize: 25 })
    expect(page.entries).toEqual([])
    expect(mockWheres).toEqual([])
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

/**
 * Prod, admin/users/<uid> (AGL-3660): every AI guided-start output twice, one
 * row Where = the site, one Where = "Organization", the same second.
 * `logAiJobOutput` files a site output in both logs on purpose, and this
 * view reads both; the account's view shows the event once, as the site row.
 */
describe('readActorActivity: a site event filed in both logs', () => {
  const generated = (id: string, parent: string, seconds: number, name: string): FakeDoc => {
    const target = { type: 'screen', id: `s-${name}`, name }
    return {
      id,
      parent,
      data: {
        actorId: 'u1',
        actorEmail: 'ada@example.test',
        action: 'ai.job.output',
        target,
        searchTokens: activitySearchTokens({ actorEmail: 'ada@example.test', target }),
        createdAt: { seconds },
      },
    }
  }
  const pairs = (names: string[]) =>
    names.flatMap((name, index) => [
      generated(`${name}-site`, 'hosts/GWhK3xjtDE', 900 - index, name),
      generated(`${name}-org`, 'orgs/o1', 900 - index, name),
    ])

  it('shows it once, as the site row, and keeps an org-only event', async () => {
    mockCorpus = [
      ...pairs(['Services', 'Home']),
      generated('layout-org', 'orgs/o1', 800, 'Main Layout'),
    ]
    const page = await readActorActivity({ actorId: 'u1', pageSize: 25 })
    expect(page.entries.map((e) => `${e.scopeType}:${e.$id}`)).toEqual([
      'host:Services-site',
      'host:Home-site',
      'org:layout-org',
    ])
  })

  it('still fills a page when every row has a copy', async () => {
    mockCorpus = pairs(['A', 'B', 'C', 'D'])
    const page = await readActorActivity({ actorId: 'u1', pageSize: 3 })
    expect(page.entries.map((e) => e.$id)).toEqual(['A-site', 'B-site', 'C-site'])
    expect(page.nextCursor).not.toBeNull()
  })

  it('never shows a copy whose site row ended the previous page', async () => {
    mockCorpus = pairs(['A', 'B', 'C', 'D', 'E'])
    const seen: string[] = []
    let cursor: string | null = null
    for (let guard = 0; guard < 10; guard += 1) {
      const result: Awaited<ReturnType<typeof readActorActivity>> =
        await readActorActivity({ actorId: 'u1', pageSize: 2, cursor })
      seen.push(...result.entries.map((entry) => entry.$id))
      cursor = result.nextCursor
      if (!cursor) break
    }
    expect(seen).toEqual(['A-site', 'B-site', 'C-site', 'D-site', 'E-site'])
  })

  it('also when the org copy was written first and sorts first', async () => {
    mockCorpus = ['A', 'B', 'C'].flatMap((name, index) => [
      generated(`${name}-org`, 'orgs/o1', 900 - index, name),
      generated(`${name}-site`, 'hosts/h1', 900 - index, name),
    ])
    const seen: string[] = []
    let cursor: string | null = null
    for (let guard = 0; guard < 10; guard += 1) {
      const result: Awaited<ReturnType<typeof readActorActivity>> =
        await readActorActivity({ actorId: 'u1', pageSize: 1, cursor })
      seen.push(...result.entries.map((entry) => entry.$id))
      cursor = result.nextCursor
      if (!cursor) break
    }
    expect(seen).toEqual(['A-site', 'B-site', 'C-site'])
  })
})
