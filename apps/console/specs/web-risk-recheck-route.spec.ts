/**
 * @jest-environment node
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
 * The daily link re-check route (AGL-3451): cron-secret only; a GET walks a
 * chunk and looks nothing up; a POST stamps its beat, resumes from the
 * cursor it is handed, drops the cached pages of every site it held a page
 * on, and places the security holds that held pages asked for (AGL-3450)
 * before it answers. The walk itself is `link-reputation-review.spec.ts`.
 */

const mockRecheck = jest.fn()
const mockApplyHolds = jest.fn()
const mockRevalidate = jest.fn()
const mockBeats: string[] = []

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    const query: Record<string, string> = {}
    for (const [key, value] of url.searchParams) query[key] = value
    return {
      method: request.method,
      query,
      body: request.method === 'GET' ? undefined : await request.json().catch(() => undefined),
      headers: Object.fromEntries(request.headers),
    }
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => ({ name: 'firestore' }) }) },
}))

jest.mock('@aglyn/tenant-data-admin/server/link-reputation-review', () => ({
  __esModule: true,
  recheckLivePageLinks: (options: unknown) => mockRecheck(options),
}))

jest.mock('../utils/server/page-security-hold', () => ({
  __esModule: true,
  applyPendingSecurityHolds: (firestore: unknown) => mockApplyHolds(firestore),
}))

jest.mock('../utils/server/tenant-revalidate', () => ({
  __esModule: true,
  revalidateEntireHost: (firestore: unknown, hostId: string) => mockRevalidate(firestore, hostId),
}))

jest.mock('../utils/cron-beat', () => ({
  __esModule: true,
  recordCronBeat: async (jobId: string) => {
    mockBeats.push(jobId)
  },
}))

const ORIGINAL_ENV = process.env
const CHUNK = {
  sites: 200,
  pages: 3,
  hosts: 4,
  listed: 1,
  unknown: 0,
  reviewed: 1,
  held: 1,
  heldHostIds: ['host-1'],
  nextCursor: 'host-200',
  done: false,
}

function loadRoute() {
  jest.resetModules()
  return require('../app/api/admin/web-risk-recheck/route') as {
    GET: (request: Request) => Promise<Response>
    POST: (request: Request) => Promise<Response>
  }
}

function request(method: 'GET' | 'POST', body?: unknown, secret = 'cron-fake') {
  return new Request('https://app.aglyn.com/api/admin/web-risk-recheck', {
    method,
    headers: {
      'x-cron-secret': secret,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, CRON_SECRET: 'cron-fake' } as NodeJS.ProcessEnv
  mockBeats.length = 0
  mockRecheck.mockReset().mockResolvedValue(CHUNK)
  mockApplyHolds.mockReset().mockResolvedValue({ pending: 1, applied: 1, skipped: 0, failed: 0, holds: [] })
  mockRevalidate.mockReset().mockResolvedValue({ reason: 'ok' })
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('the daily link re-check route', () => {
  it('refuses a caller without the cron secret', async () => {
    const response = await loadRoute().POST(request('POST', {}, 'wrong'))
    expect(response.status).toBe(401)
    expect(mockRecheck).not.toHaveBeenCalled()
  })

  it('a GET walks a chunk dry: no beat, no lookup, no hold', async () => {
    mockRecheck.mockResolvedValue({ ...CHUNK, held: 0, heldHostIds: [] })
    const response = await loadRoute().GET(request('GET'))
    expect(response.status).toBe(200)
    expect(mockRecheck).toHaveBeenCalledWith({ cursor: null, dryRun: true })
    expect(mockBeats).toEqual([])
    expect(mockApplyHolds).not.toHaveBeenCalled()
  })

  it('a POST resumes from its cursor, drops held sites’ pages and places the security holds', async () => {
    const response = await loadRoute().POST(request('POST', { cursor: 'host-0' }))
    const body = (await response.json()) as Record<string, unknown>
    expect(response.status).toBe(200)
    expect(mockBeats).toEqual(['web-risk-recheck'])
    expect(mockRecheck).toHaveBeenCalledWith({ cursor: 'host-0', dryRun: false })
    expect(mockRevalidate).toHaveBeenCalledWith({ name: 'firestore' }, 'host-1')
    expect(mockApplyHolds).toHaveBeenCalledTimes(1)
    // The Cloud Scheduler sweep follows these two fields.
    expect(body).toMatchObject({ done: false, nextCursor: 'host-200', securityHolds: { applied: 1 } })
  })

  it('places no holds when it held nothing', async () => {
    mockRecheck.mockResolvedValue({ ...CHUNK, held: 0, heldHostIds: [], done: true, nextCursor: null })
    const response = await loadRoute().POST(request('POST', {}))
    expect(response.status).toBe(200)
    expect(mockApplyHolds).not.toHaveBeenCalled()
    expect(mockRevalidate).not.toHaveBeenCalled()
  })
})

export {}
