/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
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
 * `Idempotency-Key` on the public REST API actually dedupes (AGL-1709).
 *
 * `POST /v1/datasets/{id}/records` implemented the key as a read-then-create:
 * read the key doc, replay if present, otherwise create the record and then
 * write the key. That is the exact race the mechanism exists to prevent — two
 * concurrent requests with one key both read "absent", both fall through, both
 * create — and the trailing key `create()` had its rejection swallowed, so the
 * loser silently kept its duplicate. This is the public API, where retries are
 * automated on a timer rather than a cashier tapping twice.
 *
 * Every assertion below counts the record documents that ACTUALLY LANDED in
 * the store rather than trusting the handler's response, in the manner of
 * `refund.spec.ts` (AGL-1696) — a handler that answers 200 twice while writing
 * two rows passes any response-shaped test.
 *
 * Firestore is an in-memory map keyed by document path. `create()` checks and
 * sets synchronously after its yield point, so it is atomic with respect to
 * the event loop in the same way the real one is atomic with respect to the
 * cluster — which is what lets the concurrency case be deterministic rather
 * than a race against the scheduler.
 */

/** Every document, by path. The thing the assertions read. */
const mockDocs = new Map<string, Record<string, unknown>>()

/** Flip to make the record write fail, without failing anything else. */
let mockRecordWriteFails = false
/** What `validateDocument` returns. Empty means the body is fine. */
let mockValidationErrors: Record<string, string> = {}
/** Deterministic record ids, so assertions can name them. */
let mockUidSeq = 0

/** Yield, so two in-flight requests actually interleave. */
const tick = () => Promise.resolve()

function mockDocRef(path: string) {
  const id = path.slice(path.lastIndexOf('/') + 1)
  return {
    path,
    id,
    collection: (name: string) => mockCollectionRef(`${path}/${name}`),
    get: async () => {
      await tick()
      return {
        id,
        exists: mockDocs.has(path),
        data: () => mockDocs.get(path),
        get: (field: string) => mockDocs.get(path)?.[field],
      }
    },
    create: async (data: Record<string, unknown>) => {
      await tick()
      if (path.includes('/records/') && mockRecordWriteFails) {
        throw new Error('firestore unavailable')
      }
      // The dedupe primitive: a create on an existing document is rejected.
      if (mockDocs.has(path)) throw new Error('ALREADY_EXISTS')
      mockDocs.set(path, { ...data })
    },
    set: async (
      data: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      await tick()
      mockDocs.set(path, {
        ...(options?.merge ? (mockDocs.get(path) ?? {}) : {}),
        ...data,
      })
    },
    update: async (data: Record<string, unknown>) => {
      await tick()
      mockDocs.set(path, { ...(mockDocs.get(path) ?? {}), ...data })
    },
    delete: async () => {
      await tick()
      mockDocs.delete(path)
    },
  }
}

function mockCollectionRef(path: string) {
  return {
    path,
    doc: (id: string) => mockDocRef(`${path}/${id}`),
    count: () => ({
      get: async () => {
        await tick()
        return { data: () => ({ count: childPaths(path).length }) }
      },
    }),
  }
}

/** Immediate children of a collection path — not grandchildren. */
function childPaths(collectionPath: string): string[] {
  const prefix = `${collectionPath}/`
  return [...mockDocs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

const mockFirestore = { collection: (name: string) => mockCollectionRef(name) }

jest.mock('@aglyn/tenant-data-admin', () => {
  // The real error envelope and the real header builder: this spec is about
  // what reaches the wire.
  const apiHttp = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/api-http',
  )
  return {
    __esModule: true,
    ...apiHttp,
    verifyApiKey: async () => ({
      orgId: 'org-1',
      keyId: 'key-1',
      scopes: ['datasets:read', 'datasets:write'],
    }),
    getOrgDoc: async () => ({ plan: 'business' }),
    lockdownRefusal: async () => null,
    consumeRateLimit: async () => ({
      allowed: true,
      limit: 120,
      remaining: 119,
      resetMs: Date.now() + 60_000,
      degraded: false,
    }),
    firebaseAdmin: {
      app: () => ({ firestore: () => mockFirestore }),
      firestore: {
        FieldValue: {
          increment: (n: number) => n,
          serverTimestamp: () => 'NOW',
        },
      },
    },
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL claim (AGL-1697). Stubbing it would leave this spec asserting
  // against its own mock, and the `create()`-rejection-as-dedupe primitive is
  // the entire subject.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/api-idempotency'),
  checkEntitlement: () => true,
  effectiveDatasetModel: () => ({ fields: [] }),
  coerceDocumentValues: (_model: unknown, values: Record<string, unknown>) =>
    values,
  validateDocument: () => mockValidationErrors,
  createResourceUid: () => `rec_${++mockUidSeq}`,
}))

jest.mock('firebase-admin/firestore', () => {
  // Declared INSIDE the factory: `jest.mock` is hoisted above every
  // module-scope binding, so a class defined above would be in its temporal
  // dead zone here. `serialize()` does `value instanceof Timestamp`, so this
  // has to be a real constructor and the same one the handler stamps with.
  // A parameter property (`constructor(readonly ms)`) reads to jest's
  // out-of-scope guard as a bare variable access and is rejected, so the
  // field is assigned the long way.
  class MockTimestamp {
    ms: number
    constructor(ms: number) {
      this.ms = ms
    }
    static now() {
      return new MockTimestamp(1_760_000_000_000)
    }
    toDate() {
      return new Date(this.ms)
    }
  }
  return {
    __esModule: true,
    FieldPath: { documentId: () => '__name__' },
    Timestamp: MockTimestamp,
  }
})

import { POST } from '../app/api/v1/[[...route]]/route'

const DATASET = 'orgs/org-1/datasets'

interface PostOptions {
  dataset?: string
  key?: string | null
  values?: Record<string, unknown>
}

function post({ dataset = 'ds_1', key = null, values = {} }: PostOptions = {}) {
  const headers: Record<string, string> = {
    authorization: 'Bearer aglyn_sk_test',
    'content-type': 'application/json',
  }
  if (key) headers['Idempotency-Key'] = key
  const request = new Request(
    `https://app.aglyn.com/api/v1/datasets/${dataset}/records`,
    { method: 'POST', headers, body: JSON.stringify({ values }) },
  )
  return POST(request, {
    params: Promise.resolve({ route: ['datasets', dataset, 'records'] }),
  })
}

/** The record documents that actually landed in a dataset. */
const recordsIn = (dataset: string) =>
  childPaths(`${DATASET}/${dataset}/records`)

/** The claim documents that actually landed. */
const claims = () => childPaths('apiIdempotency')

beforeEach(() => {
  mockDocs.clear()
  mockRecordWriteFails = false
  mockValidationErrors = {}
  mockUidSeq = 0
  // Two datasets exist; nothing else does.
  mockDocs.set(`${DATASET}/ds_1`, { displayName: 'Team', fields: [] })
  mockDocs.set(`${DATASET}/ds_2`, { displayName: 'Menu', fields: [] })
})

describe('AGL-1709 · the REST API claims a key before it writes', () => {
  // ── The race the read-then-create could not survive ───────────────────────

  it('lands ONE record when two concurrent posts carry the same key', async () => {
    const [a, b] = await Promise.all([
      post({ key: 'k-1', values: { name: 'Avery' } }),
      post({ key: 'k-1', values: { name: 'Avery' } }),
    ])

    // The load-bearing assertion. Under the read-then-create both requests
    // read "no prior key", both fell through, and TWO records landed — while
    // the loser's key write failed and was swallowed, so it kept its
    // duplicate and answered 201 as if nothing had happened.
    expect(recordsIn('ds_1')).toHaveLength(1)

    // The winner creates; the loser finds the claim taken and not yet settled,
    // and is refused rather than served. Failing closed here IS the fix: the
    // alternative outcome is the duplicate row above.
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([201, 409])
    const refused = a.status === 409 ? a : b
    expect(await refused.json()).toMatchObject({
      error: { type: 'conflict', code: 'idempotency_in_progress' },
    })
  })

  it('replays a settled key even after the record was deleted', async () => {
    const first = await post({ key: 'k-1', values: { name: 'Avery' } })
    expect(first.status).toBe(201)
    const { id } = await first.json()

    // The integrator deletes the row, then an automated retry of the original
    // attempt arrives — a lost response being re-sent, not a new intent.
    mockDocs.delete(`${DATASET}/ds_1/records/${id}`)

    const retry = await post({ key: 'k-1', values: { name: 'Avery' } })

    // The old lookup replayed only if the record still existed, so it fell
    // through here and minted a SECOND record — and could be made to do so
    // indefinitely, because its key write kept failing into the same catch.
    expect(recordsIn('ds_1')).toHaveLength(0)
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ id, object: 'record' })
  })

  it('dedupes a key on a SECOND dataset instead of minting a record per retry', async () => {
    await post({ dataset: 'ds_1', key: 'k-1', values: { name: 'Avery' } })

    // The docs publish that replay is looked up "within the dataset you're
    // posting to", so reusing one key against another dataset creates a
    // second record. True of the first call under the old code and false
    // forever after: its digest was org-scoped, so every retry read a
    // `recordId` that does not exist in ds_2, fell through, and created
    // again — three posts, three rows.
    for (let i = 0; i < 3; i += 1) {
      await post({ dataset: 'ds_2', key: 'k-1', values: { name: 'Avery' } })
    }

    expect(recordsIn('ds_1')).toHaveLength(1)
    expect(recordsIn('ds_2')).toHaveLength(1)
  })

  // ── The contract the fix must not break ───────────────────────────────────

  it('returns 201 on a fresh create and 200 on a replay', async () => {
    const created = await post({ key: 'k-1', values: { name: 'Avery' } })
    expect(created.status).toBe(201)
    const body = await created.json()
    expect(body).toMatchObject({ object: 'record', values: { name: 'Avery' } })

    const replayed = await post({ key: 'k-1', values: { name: 'Avery' } })
    // `conventions.md` publishes the status as how a client tells the two
    // apart, so the replay must NOT echo the original 201.
    expect(replayed.status).toBe(200)
    expect(await replayed.json()).toEqual(body)
    expect(recordsIn('ds_1')).toHaveLength(1)
  })

  it('rings a real second record for a DIFFERENT key and an identical body', async () => {
    await post({ key: 'k-1', values: { name: 'Avery' } })
    const second = await post({ key: 'k-2', values: { name: 'Avery' } })

    // The mirror of "the same coffee rung twice is a real second sale"
    // (AGL-1691). This is the case that fails the moment anyone is tempted to
    // derive the key from the request body.
    expect(second.status).toBe(201)
    expect(recordsIn('ds_1')).toHaveLength(2)
  })

  it('still creates, and dedupes nothing, when no key is sent', async () => {
    await post({ values: { name: 'Avery' } })
    await post({ values: { name: 'Avery' } })

    // An integration that has never sent the header must not start failing.
    expect(recordsIn('ds_1')).toHaveLength(2)
    expect(claims()).toHaveLength(0)
  })

  // ── Claim lifecycle ──────────────────────────────────────────────────────

  it('does not burn the key on a validation rejection', async () => {
    mockValidationErrors = { name: 'Required' }
    const rejected = await post({ key: 'k-1', values: {} })
    expect(rejected.status).toBe(400)

    // The claim is taken BELOW validation, so a deterministic 400 never
    // touches it — cheaper than taking-and-releasing, and it cannot leak.
    expect(claims()).toHaveLength(0)

    mockValidationErrors = {}
    const fixed = await post({ key: 'k-1', values: { name: 'Avery' } })
    expect(fixed.status).toBe(201)
    expect(recordsIn('ds_1')).toHaveLength(1)
  })

  it('releases the key when the record write fails', async () => {
    mockRecordWriteFails = true
    const failed = await post({ key: 'k-1', values: { name: 'Avery' } })
    expect(failed.status).toBe(500)

    // Deliberately the OPPOSITE of the refund (AGL-1696), which strands the
    // key on an unknown outcome because a released one costs a second refund.
    // Nothing on `/v1` moves money: a duplicate row is reversible by the
    // integrator with one DELETE, while a stranded key — documented as never
    // expiring, and typically derived from an upstream event id — means that
    // event can never be written at all.
    expect(claims()).toHaveLength(0)

    mockRecordWriteFails = false
    const retried = await post({ key: 'k-1', values: { name: 'Avery' } })
    expect(retried.status).toBe(201)
    expect(recordsIn('ds_1')).toHaveLength(1)
  })

  it('stamps orgId on the claim so the erase cascade sweeps it', async () => {
    await post({ key: 'k-1', values: { name: 'Avery' } })

    const [claimPath] = claims()
    expect(claimPath).toBeDefined()
    // `eraseOrgIdempotencyKeys` (AGL-1448) finds these by field, not by
    // ancestry — an unstamped claim survives org erasure invisibly.
    expect(mockDocs.get(claimPath)).toMatchObject({
      orgId: 'org-1',
      kind: 'records',
      // The org rides in `scopeId` too, so it reaches the DIGEST and not only
      // the swept field: the claim stores the response body, and a dataset id
      // is unique under its org rather than globally, so an org-less digest
      // could replay one tenant's record to another.
      scopeId: 'org-1:ds_1',
      status: 'done',
    })
  })
})
