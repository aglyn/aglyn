/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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
 * `/api/admin/drain-publish-outbox` — the other end of the closed tab
 * (AGL-2575).
 *
 * The publish seam writes the announce down; this is what fires it. The three
 * things only the route can get wrong are who may call it, whether it can be
 * made to do anything other than drop a cache, and what it does with an entry
 * it cannot drain — which is the half AGL-2573 got wrong at a different
 * level, by leaving a failure indistinguishable from a success.
 */

export {}

interface OutboxRow {
  id: string
  hostId?: unknown
  paths?: unknown
  attempts?: number
  ageMs?: number
}

let mockRows: OutboxRow[] = []
const mockDeleted: string[] = []
const mockMerged: { id: string; data: Record<string, unknown> }[] = []
const mockHostDocs = new Map<string, { subdomain?: string; cname?: string }>()

const mockBeat = jest.fn(async (_id: string) => undefined)
const mockPost = jest.fn(async (_options: unknown) => ({
  revalidated: ['/home'],
  reason: 'ok' as string,
  pathsDropped: 0,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    const raw = await request.text().catch(() => '')
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      body: raw ? JSON.parse(raw) : {},
      headers: Object.fromEntries(request.headers.entries()),
    }
  },
}))

jest.mock('../utils/cron-beat', () => ({
  __esModule: true,
  recordCronBeat: (id: string) => mockBeat(id),
}))

jest.mock('../utils/server/tenant-revalidate', () => ({
  __esModule: true,
  postTenantRevalidate: (options: unknown) => mockPost(options),
}))

/** The query the route runs, and the two document handles it uses. */
const mockOutboxQuery = () => {
  const docs = mockRows.map((row) => ({
    ref: {
      delete: async () => {
        mockDeleted.push(row.id)
      },
      set: async (data: Record<string, unknown>) => {
        mockMerged.push({ id: row.id, data })
      },
    },
    get: (field: string) => {
      if (field === 'createdAt') {
        const ageMs = row.ageMs ?? 10 * 60_000
        return { toMillis: () => Date.now() - ageMs }
      }
      return (row as unknown as Record<string, unknown>)[field]
    },
  }))
  return { docs, size: docs.length }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => ({
          orderBy: () => ({ limit: () => ({ get: async () => mockOutboxQuery() }) }),
          doc: (id: string) => ({
            get: async () => ({
              exists: mockHostDocs.has(id),
              get: (field: string) =>
                (mockHostDocs.get(id) as Record<string, unknown> | undefined)?.[field],
            }),
          }),
          name,
        }),
      }),
    }),
    firestore: {
      FieldValue: { increment: (by: number) => ({ __increment: by }) },
    },
  },
}))

const { GET, POST } = require('../app/api/admin/drain-publish-outbox/route') as {
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
}

const SECRET = 'cron-secret-value'
const URL_BASE = 'https://app.aglyn.com/api/admin/drain-publish-outbox'

const post = (search = '') =>
  POST(
    new Request(`${URL_BASE}${search}`, {
      method: 'POST',
      headers: { 'x-cron-secret': SECRET },
    }),
  )

let logSpy: jest.SpyInstance

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  mockRows = []
  mockDeleted.length = 0
  mockMerged.length = 0
  mockHostDocs.clear()
  mockHostDocs.set('host-a', { subdomain: 'acme', cname: 'acme.com' })
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  logSpy.mockRestore()
})

/** The one telemetry line this run emitted. */
const telemetry = () =>
  JSON.parse(
    (logSpy.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('publish-outbox-drain'),
    )?.[0] as string) ?? '{}',
  )

describe('who may drive the drain', () => {
  it('refuses a caller with no secret', async () => {
    const response = await POST(new Request(URL_BASE, { method: 'POST' }))
    expect(response.status).toBe(401)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('refuses everyone when the deployment has no CRON_SECRET', async () => {
    delete process.env.CRON_SECRET
    const response = await post()
    expect(response.status).toBe(501)
  })

  it('stamps the beat /api/health/crons reads, on the POST only', async () => {
    await post()
    expect(mockBeat).toHaveBeenCalledWith('drain-publish-outbox')
    mockBeat.mockClear()
    await GET(
      new Request(URL_BASE, { headers: { 'x-cron-secret': SECRET } }),
    )
    // A human's curl is not the scheduler and must not stand in for it.
    expect(mockBeat).not.toHaveBeenCalled()
  })

  it('writes nothing on a GET', async () => {
    mockRows = [{ id: 'e1', hostId: 'host-a', paths: ['/home'] }]
    const response = await GET(
      new Request(URL_BASE, { headers: { 'x-cron-secret': SECRET } }),
    )
    const body = await response.json()
    expect(body.dryRun).toBe(true)
    expect(body.hosts).toEqual(['host-a'])
    expect(mockPost).not.toHaveBeenCalled()
    expect(mockDeleted).toEqual([])
  })
})

describe('draining a stranded publish', () => {
  it('drops the addresses the entry recorded, on both cache keys', async () => {
    mockRows = [{ id: 'e1', hostId: 'host-a', paths: ['/pricing'] }]
    await post()
    expect(mockPost).toHaveBeenCalledTimes(1)
    expect(mockPost.mock.calls[0][0]).toMatchObject({
      subdomain: 'acme',
      hostId: 'host-a',
      paths: ['/pricing'],
      // The custom domain is a SECOND cache key for the same page (AGL-1152)
      // and it is the one visitors actually use.
      cname: 'acme.com',
    })
    expect(mockDeleted).toEqual(['e1'])
  })

  it('merges a backlog into ONE announce per host', async () => {
    // A tenant that refused for an hour leaves an entry per publish. Firing
    // them one at a time answers an outage with a burst against the
    // deployment that just came back.
    mockRows = [
      { id: 'e1', hostId: 'host-a', paths: ['/a'] },
      { id: 'e2', hostId: 'host-a', paths: ['/b', '/a'] },
    ]
    await post()
    expect(mockPost).toHaveBeenCalledTimes(1)
    expect(mockPost.mock.calls[0][0]).toMatchObject({ paths: ['/a', '/b'] })
    expect(mockDeleted).toEqual(['e1', 'e2'])
  })

  it('is idempotent — a second run over the same entry drops the same tag again', async () => {
    mockRows = [{ id: 'e1', hostId: 'host-a', paths: ['/pricing'] }]
    await post()
    await post()
    expect(mockPost).toHaveBeenCalledTimes(2)
    expect(mockPost.mock.calls[0][0]).toEqual(mockPost.mock.calls[1][0])
    // And nothing in either run touched published state: the only Firestore
    // writes a drain makes are the delete of a drained entry and the attempt
    // count on one that failed.
    expect(mockMerged).toEqual([])
  })

  it('leaves the entry alone while the publishing tab may still be announcing', async () => {
    mockRows = [{ id: 'fresh', hostId: 'host-a', paths: ['/x'], ageMs: 5_000 }]
    const body = await (await post()).json()
    expect(mockPost).not.toHaveBeenCalled()
    expect(body.settling).toBe(1)
    expect(mockDeleted).toEqual([])
  })

  it('releases entries for a site that no longer exists', async () => {
    mockRows = [{ id: 'gone', hostId: 'host-mockDeleted', paths: ['/x'] }]
    const body = await (await post()).json()
    expect(mockPost).not.toHaveBeenCalled()
    expect(mockDeleted).toEqual(['gone'])
    expect(body.drained).toBe(1)
  })

  it('refuses to send a path an entry had no business carrying', async () => {
    // An outbox entry is a client-written document. A path out of one is
    // trusted no further than one posted to /api/screens/revalidate.
    mockRows = [{ id: 'bad', hostId: 'host-a', paths: ['../../etc', 'nope'] }]
    const body = await (await post()).json()
    expect(mockPost).not.toHaveBeenCalled()
    expect(body.malformed).toBe(1)
    // Left in place: an entry the rules should have refused is worth finding.
    expect(mockDeleted).toEqual([])
  })
})

describe('an announce that will not land stays a queryable record', () => {
  it('keeps the entry and counts the attempt when the tenant refuses', async () => {
    mockPost.mockResolvedValueOnce({
      revalidated: [],
      reason: 'tenant-429',
      pathsDropped: 0,
    })
    mockRows = [{ id: 'e1', hostId: 'host-a', paths: ['/x'] }]
    const body = await (await post()).json()
    expect(mockDeleted).toEqual([])
    expect(mockMerged).toEqual([
      {
        id: 'e1',
        data: {
          attempts: { __increment: 1 },
          lastAttemptAtMs: expect.any(Number),
          lastReason: 'tenant-429',
        },
      },
    ])
    expect(body.failed).toBe(1)
  })

  it('stops spending tenant calls once an entry has used its attempts', async () => {
    mockRows = [{ id: 'stuck', hostId: 'host-a', paths: ['/x'], attempts: 8 }]
    const body = await (await post()).json()
    expect(mockPost).not.toHaveBeenCalled()
    expect(body.stalled).toBe(1)
    // KEPT, not mockDeleted. The record is the only evidence that a publish never
    // reached the live site — deleting it rebuilds the absence-of-evidence
    // shape AGL-2573 found, one level up.
    expect(mockDeleted).toEqual([])
  })

  it('ages a still-pending entry into a number somebody can alert on', async () => {
    mockPost.mockResolvedValueOnce({
      revalidated: [],
      reason: 'error',
      pathsDropped: 0,
    })
    mockRows = [{ id: 'old', hostId: 'host-a', paths: ['/x'], ageMs: 90 * 60_000 }]
    const body = await (await post()).json()
    expect(body.stalePending).toBe(1)
    expect(body.oldestPendingAgeMs).toBeGreaterThanOrEqual(90 * 60_000)
  })
})

describe('the telemetry line', () => {
  it('is written on every run, including one that found nothing', async () => {
    /*
      The AGL-2573 lesson stated as a rule. Every `[tenant-revalidate]` line
      used to be a `console.error` on a failure branch, so six hours of empty
      logs read identically to six hours of publishes that all worked — which
      is how an eleven-day outage passed for calm. A drain that only spoke up
      when it failed would be the same instrument.
    */
    await post()
    expect(telemetry()).toMatchObject({
      tag: 'AGL-2575:publish-outbox-drain',
      examined: 0,
      drained: 0,
      failed: 0,
      stalled: 0,
      stalePending: 0,
    })
  })

  it('names what a real run did', async () => {
    mockRows = [
      { id: 'e1', hostId: 'host-a', paths: ['/x'] },
      { id: 'stuck', hostId: 'host-a', paths: ['/y'], attempts: 8 },
    ]
    await post()
    expect(telemetry()).toMatchObject({
      examined: 2,
      hosts: 1,
      drained: 1,
      stalled: 1,
    })
  })
})
