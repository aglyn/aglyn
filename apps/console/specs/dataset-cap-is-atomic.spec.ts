/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * AGL-2371 — `/api/orgs/datasets` holds `datasetsPerOrg` and
 * `recordsPerDataset` under CONCURRENCY.
 *
 * AGL-2231 named the shape on `/api/hosts/resources`: count, decide, await
 * something, then write. Every await is a yield, so N in-flight POSTs each read
 * the same pre-count, each find room, and each land — and nothing re-counts
 * afterwards, so the extra rows are permanent. This route had it three times:
 *
 *  - **`create-dataset`** counted with `count().get()`, decided, then built a
 *    payload and `create`d.
 *  - **`create-record`** counted, decided, then awaited the BYTE gate
 *    (`refuseIfDataStorageBlocked`) before creating — a long await sitting
 *    exactly between the decision and the write.
 *  - **`import-records`** counted once, decided once for the whole import, then
 *    committed a series of `WriteBatch`es. A batch is atomic but NOT
 *    conditional on a read taken before it (the AGL-2369 lesson), so two
 *    concurrent imports each priced themselves off the same pre-count and both
 *    landed in full.
 *
 * ## What the double models, and why that is not cheating
 *
 * `Transaction.get(AggregateQuery)` holds a pessimistic lock on the documents
 * the underlying query matched, so two transactions counting the same
 * collection cannot both commit against the same snapshot: the loser aborts,
 * retries, re-reads the higher count and is refused. The fake below models that
 * and nothing more — a body runs holding a global lock, reads see the store as
 * of that moment, buffered writes apply on commit, a read after a write throws
 * as the server does, and `create` on an existing id throws as the server does.
 *
 * **The lock is on the TRANSACTION, not on the handler.** That is what makes
 * this suite discriminate rather than decorate: the route still carries a
 * pre-check outside the transaction, and with the authoritative check hoisted
 * back out beside it, serializing the transaction body changes nothing —
 * because the count was already taken. See `FORCED RED` on each concurrency
 * test for the exact mutation and its result.
 *
 * ## Both halves, always
 *
 * A suite asserting only "the next one is refused" also passes against a route
 * that refuses everything. So every case pins the pair: the last permitted
 * write SUCCEEDS and the next is refused, the concurrent cases assert the EXACT
 * number of survivors, an UNLIMITED plan lands all of them, and a paid finite
 * plan is enforced at ITS number rather than free's.
 */

const mockVerifyIdToken = jest.fn()

/** Sequential ids, so twenty concurrent creates are twenty distinct rows. */
let mockUid = 0

const mockState: {
  org: Record<string, unknown>
  /** `orgs/{org}/datasets`, keyed by id — the SERVER's view. */
  datasets: Map<string, Record<string, unknown>>
  /** `orgs/{org}/datasets/{id}/records`, keyed by dataset id then record id. */
  records: Map<string, Map<string, Record<string, unknown>>>
  /** How many transaction bodies ran, including retries. */
  attempts: number
} = {
  org: {},
  datasets: new Map(),
  records: new Map(),
  attempts: 0,
}

const recordsOf = (datasetId: string) => {
  if (!mockState.records.has(datasetId)) {
    mockState.records.set(datasetId, new Map())
  }
  return mockState.records.get(datasetId)!
}

/**
 * A collection of plain documents: the aggregate, and `doc().create()` with
 * Firestore's real "fails if it already exists" behaviour.
 *
 * `count()` returns a marker the transaction double recognises rather than a
 * number, so a route that counted OUTSIDE the transaction and handed the answer
 * in could not be mistaken for one that counted inside it.
 */
const mockCollection = (store: Map<string, Record<string, unknown>>) => ({
  __count: () => store.size,
  count: () => ({
    __count: () => store.size,
    get: async () => ({ data: () => ({ count: store.size }) }),
  }),
  doc: (id: string) => ({
    id,
    get: async () => ({
      exists: store.has(id),
      data: () => store.get(id),
      get: (field: string) => (store.get(id) ?? {})[field],
    }),
    create: async (payload: Record<string, unknown>) => {
      if (store.has(id)) {
        throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
      }
      store.set(id, payload)
    },
  }),
})

/**
 * The dataset document the record actions read: it exists, and carries a model
 * the seeded values satisfy.
 */
const mockDatasetDoc = (datasetId: string) => ({
  id: datasetId,
  get: async () => ({
    exists: mockState.datasets.has(datasetId),
    data: () => mockState.datasets.get(datasetId),
  }),
  collection: () => mockCollection(recordsOf(datasetId)),
  create: async (payload: Record<string, unknown>) => {
    if (mockState.datasets.has(datasetId)) {
      throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
    }
    mockState.datasets.set(datasetId, payload)
  },
})

const mockDatasetsCollection = () => ({
  __count: () => mockState.datasets.size,
  count: () => ({
    __count: () => mockState.datasets.size,
    get: async () => ({ data: () => ({ count: mockState.datasets.size }) }),
  }),
  doc: (id: string) => mockDatasetDoc(id),
})

const mockOrgRef: any = {
  id: 'org-1',
  path: 'orgs/org-1',
  get: async () => ({ exists: true, data: () => mockState.org }),
  collection: (name: string) =>
    name === 'datasets' ? mockDatasetsCollection() : mockCollection(new Map()),
}

/**
 * A transaction that SERIALIZES and defers its writes, which is what the fix
 * leans on.
 *
 * One global lock stands in for the per-collection pessimistic lock: a request
 * here touches one org and one records collection, so a finer-grained model
 * would be more code for the same verdict. Each body runs to completion —
 * reads, then decision, then the buffered writes applied on commit — before the
 * next begins. The serialization is what makes the second body's COUNT see the
 * first body's write, which is the property under test.
 */
let mockLock: Promise<unknown> = Promise.resolve()
const mockRunTransaction = async (body: (tx: any) => Promise<any>) => {
  const attempt = mockLock.then(async () => {
    mockState.attempts += 1
    const buffered: Array<() => unknown> = []
    const result = await body({
      get: async (target: any) => {
        if (buffered.length) {
          throw new Error('Firestore transactions cannot read after a write')
        }
        // An aggregate query answers with the store as of RIGHT NOW, inside
        // the lock. A route that counted before the transaction opened cannot
        // reach this branch at all.
        if (typeof target?.__count === 'function') {
          return { data: () => ({ count: target.__count() }) }
        }
        return target.get()
      },
      create: (ref: any, payload: unknown) => {
        buffered.push(() => ref.create(payload))
      },
    })
    for (const write of buffered) await write()
    return result
  })
  // The lock must advance even when a body rejects, or one failure deadlocks
  // every later request in the suite.
  mockLock = attempt.catch(() => undefined)
  return attempt
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  Timestamp: { now: () => ({ seconds: 0 }) },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        runTransaction: (body: (tx: any) => Promise<any>) =>
          mockRunTransaction(body),
        collection: () => ({ doc: () => mockOrgRef }),
      }),
    }),
  },
  // The BYTE band never blocks here. It is a different quota with its own
  // suite (`dataset-storage-quota-enforced.spec.ts`); leaving it live would
  // let a storage 403 stand in for a row 403 and make every refusal below
  // ambiguous.
  dataStorageRefusal: async () => null,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  isServerReleaseFlagOnForOrg: async () => true,
  lockdownRefusal: async () => null,
  resolveOrgMembership: async () => ({ member: { role: 'owner' } }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan table (AGL-2072's lesson): `checkQuota`, `checkDatasetQuota`
  // and `checkEntitlement` all resolve through it, and stubbing any of them
  // would let this suite pass against a route enforcing nothing — which IS the
  // bug.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  createResourceUid: () => `uid-${(mockUid += 1)}`,
  // Validation is not what this suite is about; the model below accepts the
  // one field every seeded row carries.
  effectiveDatasetModel: () => ({
    fields: [{ id: 'name', type: 'text', label: 'Name' }],
  }),
  coerceDocumentValues: (_model: unknown, values: unknown) => values,
  validateDocument: () => ({}),
  defaultScopeForNewResource: () => 'org',
  newResourceScopeFields: () => ({ resourceScope: ['org'] }),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { POST } from '../app/api/orgs/datasets/route'

const STARTER_RECORDS = PLAN_ENTITLEMENTS.starter.recordsPerDataset
const STARTER_DATASETS = PLAN_ENTITLEMENTS.starter.datasetsPerOrg

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://app.aglyn.com/api/orgs/datasets', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ orgId: 'org-1', ...body }),
    }),
  )

const createRecord = (name: string) =>
  post({
    action: 'create-record',
    datasetId: 'ds-1',
    values: { name },
  })

const importRecords = (count: number, prefix: string) =>
  post({
    action: 'import-records',
    datasetId: 'ds-1',
    records: Array.from({ length: count }, (_unused, index) => ({
      values: { name: `${prefix}-${index}` },
    })),
  })

const createDataset = (displayName: string) =>
  post({ action: 'create-dataset', displayName, fields: ['name'] })

/** The dataset under test plus `rows` records already in it. */
const seedRecords = (rows: number) => {
  mockState.datasets = new Map([['ds-1', { displayName: 'People', fields: ['name'] }]])
  const records = new Map<string, Record<string, unknown>>()
  for (let index = 0; index < rows; index += 1) {
    records.set(`seed-${index}`, { values: { name: `Seed ${index}` }, order: index })
  }
  mockState.records = new Map([['ds-1', records]])
}

/** `datasets` datasets already in the org. */
const seedDatasets = (datasets: number) => {
  mockState.datasets = new Map()
  for (let index = 0; index < datasets; index += 1) {
    mockState.datasets.set(`seed-${index}`, { displayName: `Set ${index}` })
  }
  mockState.records = new Map()
}

const storedRecords = () => recordsOf('ds-1').size

beforeEach(() => {
  jest.clearAllMocks()
  mockLock = Promise.resolve()
  mockUid = 0
  mockState.org = { plan: 'starter' }
  mockState.datasets = new Map()
  mockState.records = new Map()
  mockState.attempts = 0
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
})

describe('the premise', () => {
  it('the plans this suite leans on carry the numbers it assumes', () => {
    // If any of these went UNLIMITED the cases below would go vacuous — every
    // write would succeed and every assertion would still pass.
    expect(STARTER_RECORDS).toBe(1000)
    expect(Number.isFinite(STARTER_RECORDS)).toBe(true)
    expect(STARTER_DATASETS).toBe(3)
    expect(PLAN_ENTITLEMENTS.enterprise.recordsPerDataset).toBe(
      Number.POSITIVE_INFINITY,
    )
    // Free is not merely a smaller number — it is zero — so a route that read
    // no plan at all would refuse everything and fail the positive controls.
    expect(PLAN_ENTITLEMENTS.free.recordsPerDataset).toBe(0)
  })
})

describe('SEQUENTIALLY: create-record admits the last row and refuses the next', () => {
  it('creates the 1000th record', async () => {
    seedRecords(STARTER_RECORDS - 1)
    const response = await createRecord('Avery')
    expect(response.status).toBe(200)
    expect(storedRecords()).toBe(STARTER_RECORDS)
  })

  it('refuses the 1001st, and writes nothing', async () => {
    seedRecords(STARTER_RECORDS)
    const response = await createRecord('Blake')
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining(`${STARTER_RECORDS}`),
    })
    // A 403 with the row created anyway is the same defect with a status in
    // front of it.
    expect(storedRecords()).toBe(STARTER_RECORDS)
  })
})

describe('CONCURRENTLY: recordsPerDataset cannot be laundered', () => {
  /**
   * FORCED RED (2026-08-19). Hoisting the authoritative count and decision back
   * out of `runTransaction` in the `create-record` leg — i.e. leaving only
   * `tx.create(recordsRef.doc(id), …)` inside and letting the pre-check stand
   * as the whole gate, which is the code as it shipped — lands **20 of 20**
   * rows on a plan that includes 1000, with `storedRecords()` at 1019. The
   * double is UNCHANGED between the two runs: serializing a transaction body
   * cannot save a count taken before it opened.
   */
  it('lands exactly the one free slot from a dataset one row short', async () => {
    const attempts = 20
    seedRecords(STARTER_RECORDS - 1)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        createRecord(`Racer ${index}`),
      ),
    )
    const created = responses.filter((response) => response.status === 200)
    const refused = responses.filter((response) => response.status === 403)

    // BOTH halves. Exactly one row fits the remaining slot, and the rest are
    // refused — not "some", not "all".
    expect(created).toHaveLength(1)
    expect(refused).toHaveLength(attempts - 1)
    expect(created.length + refused.length).toBe(attempts)
    expect(storedRecords()).toBe(STARTER_RECORDS)
    // Every request really ran a transaction; a route that stopped transacting
    // would otherwise still pass the counts above.
    expect(mockState.attempts).toBe(attempts)
  })

  it('lands nothing at all from a dataset already at its cap', async () => {
    const attempts = 20
    seedRecords(STARTER_RECORDS)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        createRecord(`Racer ${index}`),
      ),
    )
    expect(responses.filter((response) => response.status === 403)).toHaveLength(
      attempts,
    )
    expect(storedRecords()).toBe(STARTER_RECORDS)
  })

  it('an UNLIMITED plan lands all of them', async () => {
    // The other half of every cap assertion above: a gate that refused
    // everything would pass all of them and fail only this.
    mockState.org = { plan: 'enterprise' }
    const attempts = 20
    seedRecords(0)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        createRecord(`Racer ${index}`),
      ),
    )
    expect(responses.filter((response) => response.status === 200)).toHaveLength(
      attempts,
    )
    expect(storedRecords()).toBe(attempts)
    // Serialized, so every winner took the next order — no two rows share one.
    const orders = [...recordsOf('ds-1').values()].map((row) => row['order'])
    expect(new Set(orders).size).toBe(attempts)
  })

  it('a DEAD subscription is enforced at the free number it resolves to', async () => {
    // A canceled subscription downgrades to free (`resolveEffectivePlan`), and
    // free carries ZERO records — so the cap must follow the EFFECTIVE plan or
    // a canceled org keeps the allowance it stopped paying for.
    mockState.org = { plan: 'pro', billingStatus: 'canceled' }
    const attempts = 20
    seedRecords(0)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        createRecord(`Racer ${index}`),
      ),
    )
    expect(responses.filter((response) => response.status === 403)).toHaveLength(
      attempts,
    )
    expect(storedRecords()).toBe(0)
  })
})

describe('CONCURRENTLY: import-records cannot be laundered', () => {
  /**
   * FORCED RED (2026-08-19). Restoring the `firestore.batch()` loop — one
   * pre-count, one decision, then chunked `batch.commit()`s, the code as it
   * shipped — lands **1000 of 1000** rows from BOTH concurrent imports, 2000
   * rows on a plan that includes 1000.
   */
  it('two imports that each fit alone cannot both land', async () => {
    // Room for exactly one of them, and each is one chunk — so this is the
    // single-transaction shape, and the answer must be a clean 200/403 split.
    seedRecords(STARTER_RECORDS - 400)
    const [first, second] = await Promise.all([
      importRecords(400, 'a'),
      importRecords(400, 'b'),
    ])
    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([200, 403])
    expect(storedRecords()).toBe(STARTER_RECORDS)
    // The refused one wrote nothing at all: its single chunk never committed.
    const refused = first.status === 403 ? first : second
    await expect(refused.json()).resolves.toEqual(
      expect.objectContaining({ created: 0, ids: [] }),
    )
  })

  it('an import larger than one transaction still cannot overshoot', async () => {
    // 900 rows is three chunks of 400/400/100, so this is the leg that CANNOT
    // be a single transaction — `recordsPerDataset` runs to a million and a
    // transaction carries at most 500 writes. The cap has to hold anyway.
    seedRecords(0)
    const [first, second] = await Promise.all([
      importRecords(900, 'a'),
      importRecords(900, 'b'),
    ])
    const bodies = await Promise.all([first.json(), second.json()])
    const landed = bodies.reduce(
      (total, body) => total + Number(body.created ?? 0),
      0,
    )
    expect(storedRecords()).toBe(landed)
    // BOTH halves: rows really landed, and the cap was never exceeded.
    expect(landed).toBeGreaterThan(0)
    expect(landed).toBeLessThanOrEqual(STARTER_RECORDS)
    // A refused import reports what it wrote rather than claiming nothing did.
    for (const [index, response] of [first, second].entries()) {
      if (response.status === 403) {
        expect(bodies[index].created).toBe(bodies[index].ids.length)
      }
    }
  })

  it('an import that fits lands in FULL, chunk boundaries and all', async () => {
    // The positive control for the chunking: without it, "nothing overshot"
    // would also be true of a route that imported nothing.
    seedRecords(0)
    const response = await importRecords(900, 'solo')
    expect(response.status).toBe(200)
    expect(storedRecords()).toBe(900)
    // Order is contiguous across the chunk seam, which is what proves each
    // chunk re-read the live count rather than reusing the pre-count.
    const orders = [...recordsOf('ds-1').values()]
      .map((row) => Number(row['order']))
      .sort((left, right) => left - right)
    expect(orders[0]).toBe(0)
    expect(orders[899]).toBe(899)
    expect(new Set(orders).size).toBe(900)
  })

  it('refuses an import that never fitted, and writes nothing', async () => {
    seedRecords(STARTER_RECORDS - 10)
    const response = await importRecords(20, 'over')
    expect(response.status).toBe(403)
    expect(storedRecords()).toBe(STARTER_RECORDS - 10)
  })

  it('admits the import that exactly fills the plan', async () => {
    seedRecords(STARTER_RECORDS - 10)
    const response = await importRecords(10, 'exact')
    expect(response.status).toBe(200)
    expect(storedRecords()).toBe(STARTER_RECORDS)
  })
})

describe('SEQUENTIALLY: create-dataset admits the last slot and refuses the next', () => {
  it('creates the 3rd dataset', async () => {
    seedDatasets(STARTER_DATASETS - 1)
    const response = await createDataset('People')
    expect(response.status).toBe(200)
    expect(mockState.datasets.size).toBe(STARTER_DATASETS)
  })

  it('refuses the 4th, and writes nothing', async () => {
    seedDatasets(STARTER_DATASETS)
    const response = await createDataset('People')
    expect(response.status).toBe(403)
    expect(mockState.datasets.size).toBe(STARTER_DATASETS)
  })
})

describe('CONCURRENTLY: datasetsPerOrg cannot be laundered', () => {
  /**
   * FORCED RED (2026-08-19). Hoisting the authoritative count and decision back
   * out of `runTransaction` in the `create-dataset` leg lands **20 of 20**
   * datasets on a plan that includes 3, with 22 stored.
   */
  it('lands exactly the one free slot from an org one dataset short', async () => {
    const attempts = 20
    seedDatasets(STARTER_DATASETS - 1)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        createDataset(`Set ${index}`),
      ),
    )
    expect(responses.filter((response) => response.status === 200)).toHaveLength(
      1,
    )
    expect(responses.filter((response) => response.status === 403)).toHaveLength(
      attempts - 1,
    )
    expect(mockState.datasets.size).toBe(STARTER_DATASETS)
    expect(mockState.attempts).toBe(attempts)
  })

  it('an UNLIMITED plan lands all of them', async () => {
    mockState.org = { plan: 'enterprise' }
    expect(PLAN_ENTITLEMENTS.enterprise.datasetsPerOrg).toBe(
      Number.POSITIVE_INFINITY,
    )
    const attempts = 20
    seedDatasets(0)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        createDataset(`Set ${index}`),
      ),
    )
    expect(responses.filter((response) => response.status === 200)).toHaveLength(
      attempts,
    )
    expect(mockState.datasets.size).toBe(attempts)
  })

  it('a PAID plan is enforced at ITS number, purchased add-ons included', async () => {
    // A gate that only refuses the plan's INCLUDED number is the same defect
    // one field over: `seatAddons.datasets` is invoiced and must raise the cap.
    mockState.org = { plan: 'starter', seatAddons: { datasets: 2 } }
    const attempts = 20
    seedDatasets(STARTER_DATASETS + 1)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        createDataset(`Set ${index}`),
      ),
    )
    expect(responses.filter((response) => response.status === 200)).toHaveLength(
      1,
    )
    expect(mockState.datasets.size).toBe(STARTER_DATASETS + 2)
  })
})
