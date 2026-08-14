/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's `Response`
 * helpers are unavailable.
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
 * AGL-1667 — the form-submit route and `rate.degraded`.
 *
 * The route read `allowed` and `resetMs` and never `degraded`, so a Firestore
 * incident quietly reverted the per-IP limiter to the per-instance behaviour
 * AGL-794 replaced and this endpoint recorded nothing about it.
 *
 * Fail-soft is NOT reversed here — that posture was decided in AGL-794 and
 * reaffirmed in AGL-1679, and the fallback can only ever allow more than
 * 10/min, never fewer, so nothing legitimate is refused by it. The claim
 * under test is about the RECORD: these rows are billed
 * (`/api/billing/report-usage` prices `counters/formSubmissions`), so a
 * submission accepted under a widened cap has to be tellable apart from one
 * accepted under the real cap, per row, afterwards.
 *
 * The AGL-1679 marker answers "the store degraded at 14:02". Only the row
 * itself can answer "this invoice line arrived during it".
 */

const HOST_ID = 'site-1'
const MONTH = new Date().toISOString().slice(0, 7)

/** Sentinel for `FieldValue.increment`, applied by the fake `set`. */
type Increment = { __increment: number }
const mockIsIncrement = (value: unknown): value is Increment =>
  typeof value === 'object' && value !== null && '__increment' in (value as any)

let mockStore: Record<string, Record<string, any>> = {}
let mockAddedSubmissions: Record<string, any>[] = []
let mockDegraded = false
let mockAllowed = true

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

const mockDocHandle = (path: string) => ({
  get: async () => {
    const data = mockStore[path]
    return {
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  },
  set: async (patch: Record<string, any>, options?: { merge?: boolean }) => {
    const base = options?.merge ? (mockStore[path] ?? {}) : {}
    const next: Record<string, any> = { ...base }
    for (const [key, value] of Object.entries(patch)) {
      next[key] = mockIsIncrement(value)
        ? Number(next[key] ?? 0) + value.__increment
        : value
    }
    mockStore[path] = next
  },
  collection: (name: string) => mockCollectionHandle(`${path}/${name}`),
})

const mockCollectionHandle = (path: string) => ({
  doc: (id: string) => mockDocHandle(`${path}/${id}`),
  add: async (data: Record<string, any>) => {
    if (!path.endsWith('formSubmissions')) {
      throw new Error(`unexpected add to ${path}`)
    }
    mockAddedSubmissions.push(data)
    return { id: `submission-${mockAddedSubmissions.length}` }
  },
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({ collection: (name: string) => mockCollectionHandle(name) }),
    }),
  },
  // The real shape `consumeRateLimit` returns, `degraded` included — the
  // field the route used to drop on the floor.
  consumeRateLimit: async () => ({
    allowed: mockAllowed,
    limit: 10,
    remaining: mockAllowed ? 9 : 0,
    resetMs: Date.now() + 30_000,
    degraded: mockDegraded,
  }),
  getOrgForHost: async () => ({ org: { plan: 'starter' } }),
  notifyHostManagers: async () => undefined,
  orgDataCollectionForHost: async () => {
    throw new Error('no dataset binding in these cases')
  },
  upsertHostContact: async () => undefined,
  visitorWriteRefusal: async () => null,
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  emitHostEvent: async () => ({ alerts: [] }),
  resolveDatasetDoc: async () => null,
}))

// Below the mocks by intent, not by accident: babel hoists `jest.mock` above
// every import, so the route under test resolves the fakes above.
import { POST } from '../app/api/forms/submit/route'

const submit = () =>
  POST(
    new Request('https://site.example/api/forms/submit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.9',
      },
      body: JSON.stringify({
        hostId: HOST_ID,
        formName: 'Contact',
        path: '/contact',
        fields: { email: 'visitor@example.com', message: 'hello' },
      }),
    }),
  ) as Promise<Response>

const counterPath = `hosts/${HOST_ID}/counters/formSubmissions`

beforeEach(() => {
  mockStore = { [`hosts/${HOST_ID}`]: { name: 'Site' } }
  mockAddedSubmissions = []
  mockDegraded = false
  mockAllowed = true
})

describe('AGL-1667 · the form route and a degraded rate limiter', () => {
  it('leaves the field OFF when the durable limiter answered', () => {
    // The control. Without it, a route that stamped unconditionally would
    // pass the case below and mark every row in the database as suspect.
    return submit().then((response) => {
      expect(response.status).toBe(200)
      expect(mockAddedSubmissions).toHaveLength(1)
      expect(mockAddedSubmissions[0]).not.toHaveProperty('rateDegraded')
      expect(Number(mockStore[counterPath]?.[MONTH])).toBe(1)
    })
  })

  it('stamps the stored submission when the limiter fell back', async () => {
    mockDegraded = true
    const response = await submit()

    // Still accepted: fail-soft is the decided posture and a Firestore blip
    // must not cost a customer a lead.
    expect(response.status).toBe(200)
    expect(mockAddedSubmissions).toHaveLength(1)
    // THE ASSERTION. The billed row says which cap it was accepted under, so
    // a spike in `counters/formSubmissions` can be correlated with the
    // degraded window instead of merely coinciding with it.
    expect(mockAddedSubmissions[0].rateDegraded).toBe(true)
    // And it is still billed — the submission is real, it is stored, and
    // quietly not charging for it would be a different bug.
    expect(Number(mockStore[counterPath]?.[MONTH])).toBe(1)
  })

  it('tells the caller nothing: the 429 is byte-identical either way', async () => {
    // This endpoint is public and unauthenticated. "The global limiter is
    // currently a per-instance one" is exactly the sentence an abuser would
    // spend the window on, so `degraded` must not reach the response.
    mockAllowed = false
    const healthy = await submit()
    const healthyBody = await healthy.text()

    mockDegraded = true
    const degraded = await submit()
    const degradedBody = await degraded.text()

    expect(degraded.status).toBe(healthy.status)
    expect(degraded.status).toBe(429)
    expect(degradedBody).toBe(healthyBody)
    expect(degradedBody).not.toMatch(/degrad/i)
    // A refusal writes no submission row in either case.
    expect(mockAddedSubmissions).toHaveLength(0)
  })

  it('writes no EXTRA document for the degradation', async () => {
    // The stamp rides a write that was happening anyway. A separate counter
    // would mean an additional Firestore write per submission, issued
    // precisely while Firestore is the thing that is failing.
    mockDegraded = true
    await submit()
    const paths = Object.keys(mockStore).sort()
    expect(paths).toEqual([`hosts/${HOST_ID}`, counterPath])
  })
})
