/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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
 * The per-user rollup's writer and readers (AGL-2928).
 *
 * The load-bearing assertion is the first one: the person's month is on the
 * SAME batch as the org's, so a commit that fails leaves neither and a
 * commit that lands leaves both. The fake below models `increment` and
 * `set(merge)` faithfully, INCLUDING a merge into a nested map — a fake
 * that replaced `byKind` on each write would fabricate a green bucket that
 * only ever held the last request.
 */

import { aiUsageByUserExpiry, aiUsageMonthKeys } from '../model/ai-usage-by-user'

let mockDocs = new Map<string, Record<string, unknown>>()
/** Every path handed to `recursiveDelete`, in order. */
let mockRecursivelyDeleted: string[] = []
/** When set, the collection-group query throws — the index is not deployed. */
let mockCollectionGroupFails = false

const isIncrement = (value: unknown): value is { __inc: number } =>
  typeof (value as { __inc?: unknown } | null)?.__inc === 'number'

const isPlainMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  !isIncrement(value)

/** `increment` and `set(merge)` semantics, nested maps included. */
function applyData(
  existing: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
  merge: boolean,
): Record<string, unknown> {
  const base = merge ? { ...(existing ?? {}) } : {}
  for (const [key, value] of Object.entries(data)) {
    if (isIncrement(value)) {
      base[key] = Number(base[key] ?? 0) + value.__inc
    } else if (isPlainMap(value) && merge) {
      base[key] = applyData(
        isPlainMap(base[key]) ? (base[key] as Record<string, unknown>) : undefined,
        value,
        true,
      )
    } else {
      base[key] = value
    }
  }
  return base
}

const snapshotOf = (path: string) => ({
  id: path.split('/').pop(),
  ref: { path },
  exists: mockDocs.has(path),
  data: () => mockDocs.get(path),
  get: (field: string) => (mockDocs.get(path) ?? {})[field],
})

function mockMakeFirestore() {
  const makeQuery = (
    matches: (path: string) => boolean,
    order: 'asc' | 'desc' = 'asc',
    cap = Number.POSITIVE_INFINITY,
    filter: (data: Record<string, unknown>) => boolean = () => true,
  ): any => ({
    where: (field: string, _op: string, expected: unknown) =>
      makeQuery(matches, order, cap, (data) => filter(data) && data[field] === expected),
    orderBy: (_field: unknown, direction: 'asc' | 'desc' = 'asc') =>
      makeQuery(matches, direction, cap, filter),
    limit: (n: number) => makeQuery(matches, order, n, filter),
    get: async () => {
      const paths = [...mockDocs.keys()]
        .filter((path) => matches(path) && filter(mockDocs.get(path) ?? {}))
        .sort()
      if (order === 'desc') paths.reverse()
      return { docs: paths.slice(0, cap).map(snapshotOf), size: Math.min(paths.length, cap) }
    },
  })
  const makeDoc = (path: string): any => ({
    id: path.split('/').pop(),
    path,
    collection: (name: string) => makeCollection(`${path}/${name}`),
    get: async () => snapshotOf(path),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      mockDocs.set(path, applyData(mockDocs.get(path), data, Boolean(options?.merge)))
    },
  })
  const makeCollection = (prefix: string): any => ({
    doc: (id: string) => makeDoc(`${prefix}/${id}`),
    ...makeQuery(
      (path) =>
        path.startsWith(`${prefix}/`) &&
        path.slice(prefix.length + 1).split('/').length === 1,
    ),
  })
  const batch = () => {
    const queued: Array<() => void> = []
    const api = {
      set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
        queued.push(() => {
          mockDocs.set(ref.path, applyData(mockDocs.get(ref.path), data, Boolean(options?.merge)))
        })
        return api
      },
      delete: (ref: { path: string }) => {
        queued.push(() => {
          mockDocs.delete(ref.path)
        })
        return api
      },
      commit: async () => {
        for (const write of queued) write()
      },
      /** Test seam: how many writes are waiting. */
      pending: () => queued.length,
    }
    return api
  }
  return {
    collection: (name: string) => makeCollection(name),
    collectionGroup: (name: string) => {
      if (mockCollectionGroupFails) {
        return {
          where: () => ({
            get: async () => {
              throw new Error('FAILED_PRECONDITION: The query requires an index')
            },
          }),
        }
      }
      return makeQuery((path) => {
        const parts = path.split('/')
        return parts.length >= 2 && parts[parts.length - 2] === name
      })
    },
    getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshotOf(ref.path)),
    recursiveDelete: async (ref: { path: string }) => {
      mockRecursivelyDeleted.push(ref.path)
      for (const path of [...mockDocs.keys()]) {
        if (path === ref.path || path.startsWith(`${ref.path}/`)) mockDocs.delete(path)
      }
    },
    batch,
  }
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (n: number) => ({ __inc: n }),
    serverTimestamp: () => '__now__',
  },
  FieldPath: { documentId: () => '__name__' },
}))

const {
  eraseUserAiUsage,
  readOrgAiUsageByUser,
  readUserAiUsageMonths,
  recordUserAiRefusal,
  recordUserAiUsage,
} = require('./ai-usage-by-user') as typeof import('./ai-usage-by-user')
const { recordAssistCost, recordAssistExchange } =
  require('./assist-usage') as typeof import('./assist-usage')

const NOW = new Date('2026-09-14T12:00:00Z')
const MONTH = '2026-09'
const ORG = 'org-1'
const monthPath = (uid: string, month = MONTH) =>
  `orgs/${ORG}/aiUsageByUser/${uid}/months/${month}`

const firestore = () => mockMakeFirestore() as unknown as FirebaseFirestore.Firestore

beforeEach(() => {
  mockDocs = new Map()
  mockRecursivelyDeleted = []
  mockCollectionGroupFails = false
})

const usage = {
  inputTokens: 1_000,
  outputTokens: 200,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

describe('the person’s month rides the org rollup’s batch', () => {
  it('recordAssistCost writes both, and the same batch carries both', async () => {
    const store = mockMakeFirestore()
    const commits: number[] = []
    const realBatch = store.batch
    store.batch = () => {
      const api = realBatch()
      const commit = api.commit
      api.commit = async () => {
        commits.push(api.pending())
        await commit()
      }
      return api
    }
    await recordAssistCost(
      store as unknown as FirebaseFirestore.Firestore,
      ORG,
      {
        route: '/api/ai/assist/element',
        hostId: 'host-1',
        model: 'claude-sonnet-5',
        tier: 'entitled',
        usage,
        docsPaths: [],
        stopReason: 'end_turn',
        uid: 'user-1',
      },
      NOW,
    )
    // ONE commit, carrying the signal, the org month and the person's month.
    expect(commits).toEqual([3])
    const org = mockDocs.get(`orgs/${ORG}/assistUsage/${MONTH}`)
    const person = mockDocs.get(monthPath('user-1'))
    expect(person).toMatchObject({
      uid: 'user-1',
      month: MONTH,
      requests: 1,
      byKind: { element: person?.credits },
      byHost: { 'host-1': person?.credits },
      expiresAt: aiUsageByUserExpiry(MONTH),
    })
    // The SAME money, to the cent of a micro-dollar: no second estimate.
    expect(person?.estCostUsd).toBe(org?.estCostUsd)
    expect(Number(person?.credits)).toBe(Math.ceil(Number(org?.estCostUsd) / 0.001))
  })

  it('a commit that fails leaves NEITHER rollup — the two cannot disagree', async () => {
    const store = mockMakeFirestore()
    store.batch = () => {
      const api = mockMakeFirestore().batch()
      api.commit = async () => {
        throw new Error('UNAVAILABLE')
      }
      return api
    }
    await expect(
      recordAssistExchange(
        store as unknown as FirebaseFirestore.Firestore,
        ORG,
        {
          uid: 'user-1',
          question: 'q',
          answer: 'a',
          route: '/acme/screens',
          hostId: null,
          model: 'claude-sonnet-5',
          tier: 'free',
          usage,
          docsPaths: [],
          stopReason: 'end_turn',
        },
        NOW,
      ),
    ).rejects.toThrow('UNAVAILABLE')
    expect(mockDocs.get(`orgs/${ORG}/assistUsage/${MONTH}`)).toBeUndefined()
    expect(mockDocs.get(monthPath('user-1'))).toBeUndefined()
  })

  it('a chat turn is an `assist` request, with no site when none was named', async () => {
    await recordAssistExchange(
      firestore(),
      ORG,
      {
        uid: 'user-1',
        question: 'q',
        answer: 'a',
        route: '/acme/screens',
        hostId: null,
        model: 'claude-sonnet-5',
        tier: 'free',
        usage,
        docsPaths: [],
        stopReason: 'end_turn',
      },
      NOW,
    )
    const person = mockDocs.get(monthPath('user-1'))
    expect(Object.keys(person?.byKind as object)).toEqual(['assist'])
    expect(person?.byHost).toBeUndefined()
  })

  it('a meter with no uid attributes to nobody and still bills the org', async () => {
    await recordAssistCost(
      firestore(),
      ORG,
      {
        route: '/api/ai/assist/blog',
        hostId: 'host-1',
        model: 'claude-sonnet-5',
        tier: 'entitled',
        usage,
        docsPaths: [],
        stopReason: 'end_turn',
      },
      NOW,
    )
    expect(mockDocs.get(`orgs/${ORG}/assistUsage/${MONTH}`)).toBeDefined()
    expect([...mockDocs.keys()].some((path) => path.includes('/aiUsageByUser/'))).toBe(false)
  })
})

describe('recordUserAiUsage', () => {
  it('accumulates across requests, per kind and per site', () => {
    const store = mockMakeFirestore()
    const orgRef = store.collection('orgs').doc(ORG)
    const batch = store.batch()
    expect(
      recordUserAiUsage(batch as never, orgRef, {
        uid: 'user-1',
        month: MONTH,
        estCostUsd: 0.0105,
        hostId: 'host-1',
        kind: 'page',
      }),
    ).toBe(true)
    recordUserAiUsage(batch as never, orgRef, {
      uid: 'user-1',
      month: MONTH,
      estCostUsd: 0.002,
      hostId: 'host-2',
      kind: 'page',
    })
    recordUserAiUsage(batch as never, orgRef, {
      uid: 'user-1',
      month: MONTH,
      estCostUsd: 0.001,
      hostId: null,
      kind: 'assist',
    })
    // Nothing lands before the commit — the batch is the caller's.
    expect(mockDocs.get(monthPath('user-1'))).toBeUndefined()
    void batch.commit()
    expect(mockDocs.get(monthPath('user-1'))).toMatchObject({
      credits: 11 + 2 + 1,
      requests: 3,
      byKind: { page: 13, assist: 1 },
      byHost: { 'host-1': 11, 'host-2': 2 },
    })
    expect(Number(mockDocs.get(monthPath('user-1'))?.estCostUsd)).toBeCloseTo(0.0135, 9)
  })

  it('skips a blank uid and queues nothing', () => {
    const store = mockMakeFirestore()
    const batch = store.batch()
    expect(
      recordUserAiUsage(batch as never, store.collection('orgs').doc(ORG), {
        uid: '  ',
        month: MONTH,
        estCostUsd: 1,
        hostId: null,
        kind: 'assist',
      }),
    ).toBe(false)
    expect(batch.pending()).toBe(0)
  })
})

describe('recordUserAiRefusal', () => {
  const refused = { allowed: false, monthKey: MONTH }

  it('counts the refusal on the person’s month, creating it if need be', async () => {
    recordUserAiRefusal(firestore(), ORG, 'user-1', refused)
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockDocs.get(monthPath('user-1'))).toMatchObject({
      uid: 'user-1',
      month: MONTH,
      refusals: 1,
      expiresAt: aiUsageByUserExpiry(MONTH),
    })
  })

  it('records nothing for an admitted reservation — the call needs no branch', async () => {
    recordUserAiRefusal(firestore(), ORG, 'user-1', { allowed: true, monthKey: MONTH })
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockDocs.size).toBe(0)
  })

  it('never throws — a refusal is already decided', () => {
    expect(() => recordUserAiRefusal({} as never, ORG, 'user-1', refused)).not.toThrow()
    expect(() => recordUserAiRefusal(firestore(), ORG, null, refused)).not.toThrow()
  })
})

describe('readOrgAiUsageByUser', () => {
  it('joins the roster, ranks dearest first, and measures each share on spend', async () => {
    mockDocs.set(`orgs/${ORG}/assistUsage/${MONTH}`, { estCostUsd: 2.5 })
    mockDocs.set(`orgs/${ORG}/members/user-a`, { displayName: 'Ada', email: 'ada@x.io', role: 'admin' })
    mockDocs.set(`orgs/${ORG}/members/user-b`, { email: 'bo@x.io', role: 'editor' })
    mockDocs.set(`orgs/${ORG}/members/user-c`, { email: 'quiet@x.io', role: 'viewer' })
    mockDocs.set(monthPath('user-a'), { credits: 700, estCostUsd: 0.7, requests: 10 })
    mockDocs.set(monthPath('user-b'), { credits: 1800, estCostUsd: 1.8, requests: 30, refusals: 2 })
    // A person who has LEFT the org keeps a document and is not listed.
    mockDocs.set(monthPath('user-gone'), { credits: 9_000, estCostUsd: 9 })
    const result = await readOrgAiUsageByUser(firestore(), ORG, MONTH)
    expect(result.orgCredits).toBe(2_500)
    expect(result.rows.map((row) => [row.uid, row.name, row.credits, row.share])).toEqual([
      ['user-b', 'bo@x.io', 1800, 0.72],
      ['user-a', 'Ada', 700, 0.28],
    ])
    expect(result.rows[0].refusals).toBe(2)
    expect(result.rows[1].role).toBe('admin')
  })

  it('reads a month with no org rollup as shares of nothing, not as a failure', async () => {
    mockDocs.set(`orgs/${ORG}/members/user-a`, { email: 'ada@x.io' })
    mockDocs.set(monthPath('user-a'), { credits: 5, estCostUsd: 0.005 })
    const result = await readOrgAiUsageByUser(firestore(), ORG, MONTH)
    expect(result.orgCredits).toBe(0)
    expect(result.rows[0].share).toBe(0)
  })
})

describe('readUserAiUsageMonths', () => {
  // The window the reader asks for, so these fixtures cannot age out of it.
  const [THIS_MONTH, LAST_MONTH, TWO_BACK] = aiUsageMonthKeys()

  it('lists newest first, capped', async () => {
    mockDocs.set(monthPath('user-a', TWO_BACK), { credits: 1 })
    mockDocs.set(monthPath('user-a', THIS_MONTH), { credits: 3 })
    mockDocs.set(monthPath('user-a', LAST_MONTH), { credits: 2 })
    const months = await readUserAiUsageMonths(firestore(), ORG, 'user-a', 2)
    expect(months.map((entry) => [entry.month, entry.credits])).toEqual([
      [THIS_MONTH, 3],
      [LAST_MONTH, 2],
    ])
  })

  it('asks by id and never orders, so it needs no index a deploy must carry (AGL-3143 §13)', async () => {
    // Production refused `orderBy(documentId, 'desc')` with FAILED_PRECONDITION
    // — Firestore indexes __name__ ascending automatically and descending not
    // at all — and /api/ai/usage?uid=… answered 500 on every call. Both
    // doubles in this repo served that query happily, which is how it shipped.
    // A month OUTSIDE the retention window is the tell: the ordered query
    // returned it, and asking for the window by id cannot.
    mockDocs.set(monthPath('user-a', THIS_MONTH), { credits: 3 })
    mockDocs.set(monthPath('user-a', '2019-01'), { credits: 99 })
    const months = await readUserAiUsageMonths(firestore(), ORG, 'user-a', 5)
    expect(months.map((entry) => entry.month)).toEqual([THIS_MONTH])
  })

  it('reads a person with no months at all as none, spending no query', async () => {
    expect(await readUserAiUsageMonths(firestore(), ORG, 'user-nobody', 3)).toEqual([])
  })
})

describe('eraseUserAiUsage', () => {
  it('deletes the subtree in every named org, then sweeps strays by uid', async () => {
    mockDocs.set(monthPath('user-a', '2026-08'), { uid: 'user-a', credits: 1 })
    mockDocs.set(monthPath('user-a', '2026-09'), { uid: 'user-a', credits: 3 })
    // An org the person was removed from months ago.
    mockDocs.set('orgs/org-old/aiUsageByUser/user-a/months/2026-03', { uid: 'user-a', credits: 9 })
    // Somebody else's month, which must survive.
    mockDocs.set(monthPath('user-b'), { uid: 'user-b', credits: 4 })
    const result = await eraseUserAiUsage(firestore(), 'user-a', [ORG])
    expect(result).toEqual({ orgs: 1, sweptMonths: 1 })
    expect(mockRecursivelyDeleted).toEqual([`orgs/${ORG}/aiUsageByUser/user-a`])
    expect([...mockDocs.keys()].filter((path) => path.includes('user-a'))).toEqual([])
    expect(mockDocs.get(monthPath('user-b'))).toBeDefined()
  })

  it('reports the sweep as null, not zero, when its index is missing', async () => {
    mockCollectionGroupFails = true
    mockDocs.set(monthPath('user-a'), { uid: 'user-a', credits: 3 })
    const result = await eraseUserAiUsage(firestore(), 'user-a', [ORG])
    expect(result).toEqual({ orgs: 1, sweptMonths: null })
    // The by-path pass still ran.
    expect(mockDocs.get(monthPath('user-a'))).toBeUndefined()
  })
})
