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
 * `/api/admin/reap-sending-domains` — the sweep, from the outside.
 *
 * What the planner decides is proved in `reap-sending-domains.spec.ts` and
 * what the vendors are asked is proved in `sending-domain-teardown.spec.ts`.
 * This file is about the three things only the route can get wrong: who may
 * call it, whether a GET can destroy anything, and whether a run that finds a
 * vendor unwilling leaves the debt standing rather than dropping it.
 */

export {}

const mockTeardown = jest.fn(async (_teardown: unknown) => ({
  outcome: 'removed' as string,
  detail: null as string | null,
}))
const mockRelease = jest.fn(async (_teardown: unknown) => undefined)
const mockRecordDebt = jest.fn(async (_teardown: unknown, _detail: unknown) => undefined)
const mockAuditAdd = jest.fn(async (_row: unknown) => undefined)
const mockBeat = jest.fn(async (_id: string) => undefined)
const mockClaims = jest.fn(() => [] as unknown[])
/** Host documents that still exist, by id, with the label each one pins. */
const mockHosts = new Map<string, string | null>()

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

jest.mock('../utils/server/provision-sending-domain', () => ({
  __esModule: true,
  teardownSendingDomain: (teardown: unknown) => mockTeardown(teardown),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  listSendingLabelClaims: async () => mockClaims(),
  readSendingDomainTeardownByLabel: async (label: string) => ({
    hostId: 'HostGone',
    orgId: 'org123',
    label,
    domain: `${label}.mail.aglyn.app`,
    providerDomainId: 'dom_live_1',
    dkimSelector: 'resend',
  }),
  releaseHostSendingDomain: (teardown: unknown) => mockRelease(teardown),
  recordSendingDomainDebt: (teardown: unknown, detail: unknown) =>
    mockRecordDebt(teardown, detail),
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => ({ id, path: `${name}/${id}` }),
          add: (row: unknown) => mockAuditAdd(row),
        }),
        getAll: async (...refs: { id: string; path: string }[]) =>
          refs.map((ref) => ({
            id: ref.id,
            exists:
              ref.path.startsWith('hosts/')
                ? mockHosts.has(ref.id)
                : ref.path.startsWith('orgs/'),
            get: (field: string) =>
              field === 'sendingLabel' ? mockHosts.get(ref.id) : undefined,
          })),
      }),
    }),
    firestore: { FieldValue: { serverTimestamp: () => '__now__' } },
  },
}))

const { GET, POST } = require('../app/api/admin/reap-sending-domains/route') as {
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
}

const SECRET = 'cron-secret-value'
const URL_BASE = 'https://app.aglyn.com/api/admin/reap-sending-domains'

/** A claim whose host is gone — the ordinary orphan. */
function orphanClaim(label = 'northwind') {
  return {
    label,
    hostId: 'HostGone',
    orgId: 'org123',
    domain: `${label}.mail.aglyn.app`,
    claimedAtMs: Date.now() - 30 * 24 * 60 * 60 * 1000,
    orphanedAtMs: null,
    teardownDetail: null,
    teardownAttempts: 0,
  }
}

const call = (method: 'GET' | 'POST', headers: Record<string, string> = {}) =>
  (method === 'GET' ? GET : POST)(
    new Request(URL_BASE, {
      method,
      headers: { 'x-cron-secret': SECRET, ...headers },
    }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockHosts.clear()
  mockClaims.mockReturnValue([])
  mockTeardown.mockResolvedValue({ outcome: 'removed', detail: null })
  process.env.CRON_SECRET = SECRET
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('who may run it', () => {
  it('refuses a caller with no cron secret', async () => {
    const response = await POST(new Request(URL_BASE, { method: 'POST' }))

    expect(response.status).toBe(401)
    expect(mockTeardown).not.toHaveBeenCalled()
  })

  it('says so plainly when the deployment has no CRON_SECRET at all', async () => {
    delete process.env.CRON_SECRET

    expect((await call('POST')).status).toBe(501)
  })

  it('stamps the beat on the SCHEDULER’s POST, so a silent job reads as red', async () => {
    await call('POST')

    expect(mockBeat).toHaveBeenCalledWith('reap-sending-domains')
  })
})

describe('a dry run', () => {
  it('reports the plan and mutates nothing', async () => {
    // The default for a GET — a browser, or a curl somebody pasted.
    mockClaims.mockReturnValue([orphanClaim()])

    const response = await GET(
      new Request(URL_BASE, { method: 'GET', headers: { 'x-cron-secret': SECRET } }),
    )
    const body = await response.json()

    expect(body.dryRun).toBe(true)
    expect(body.orphans).toBe(1)
    expect(body.released).toBe(0)
    expect(body.candidates).toEqual([
      { domain: 'northwind.mail.aglyn.app', reason: 'host-gone', attempts: 0 },
    ])
    // Nothing at either vendor, nothing in Firestore, no audit row.
    expect(mockTeardown).not.toHaveBeenCalled()
    expect(mockRelease).not.toHaveBeenCalled()
    expect(mockRecordDebt).not.toHaveBeenCalled()
    expect(mockAuditAdd).not.toHaveBeenCalled()
    // …and no beat: a human pressing GET is not the scheduler, and must not
    // make a job that stopped being scheduled read as alive.
    expect(mockBeat).not.toHaveBeenCalled()
  })
})

describe('a real run', () => {
  it('releases the orphan and records what it did', async () => {
    mockClaims.mockReturnValue([orphanClaim()])

    const body = await (await call('POST')).json()

    expect(mockTeardown).toHaveBeenCalledTimes(1)
    expect(mockRelease).toHaveBeenCalledTimes(1)
    expect(body.released).toBe(1)
    expect(body.stillOwed).toBe(0)
    expect(mockAuditAdd).toHaveBeenCalledTimes(1)
    expect(mockAuditAdd.mock.calls[0][0]).toMatchObject({
      action: 'email.sending-domains.reap',
      after: { released: ['northwind.mail.aglyn.app'] },
    })
  })

  it('leaves the debt standing when the provider refuses', async () => {
    /*
     * The state that must not be reachable: our record dropped while the
     * provider still holds the domain. The slot would then be spent on a name
     * nothing points at and nothing will ever look for again.
     */
    mockClaims.mockReturnValue([orphanClaim()])
    mockTeardown.mockResolvedValue({ outcome: 'failed', detail: 'provider-release' })

    const body = await (await call('POST')).json()

    expect(mockRelease).not.toHaveBeenCalled()
    expect(mockRecordDebt).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'northwind.mail.aglyn.app' }),
      'provider-release',
    )
    expect(body.released).toBe(0)
    expect(body.stillOwed).toBe(1)
    expect(body.owed).toEqual([
      { domain: 'northwind.mail.aglyn.app', detail: 'provider-release' },
    ])
  })

  it('leaves a LIVE site alone and writes no audit row', async () => {
    // The direction that fails if the sweep were ever pointed at everything.
    mockHosts.set('HostAbc', 'northwind')
    mockClaims.mockReturnValue([{ ...orphanClaim(), hostId: 'HostAbc' }])

    const body = await (await call('POST')).json()

    expect(body.live).toBe(1)
    expect(body.orphans).toBe(0)
    expect(mockTeardown).not.toHaveBeenCalled()
    expect(mockAuditAdd).not.toHaveBeenCalled()
  })

  it('⛔ refuses a shared pool member and says so at the top of the report', async () => {
    mockClaims.mockReturnValue([
      { ...orphanClaim('shared2'), domain: 'shared2.mail.aglyn.app' },
    ])

    const body = await (await call('POST')).json()

    expect(body.poolProtected).toEqual(['shared2.mail.aglyn.app'])
    expect(body.orphans).toBe(0)
    expect(mockTeardown).not.toHaveBeenCalled()
    expect(mockRelease).not.toHaveBeenCalled()
  })
})
