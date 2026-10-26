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
 * The nightly account-holder audience route (AGL-3780). The rules are walked
 * in `tenant-data-admin`'s `ad-audience-sync.spec.ts`; this holds the door to
 * them: the cron secret alone may send, a GET and a staff caller only read,
 * the release flag gates every send, and a failed provider raises an alert —
 * and so does a failed stage list (AGL-4072), under its own key.
 */

export {}

const mockVerifyIdToken = jest.fn()
const mockReadAccounts = jest.fn()
const mockRun = jest.fn()
const mockAlert = jest.fn()
const mockBeat = jest.fn()
let mockFlagOn = false

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (token: string) => mockVerifyIdToken(token) }),
      firestore: () => ({}),
    }),
  },
  accountBannedRecipients: async () => new Set(),
  listUsersAcrossPools: async () => ({ users: [], nextPageToken: null }),
  getServerReleaseFlagValues: async () => ({
    release_ad_audience_sync: { enabled: mockFlagOn },
  }),
}))

jest.mock('@aglyn/tenant-data-admin/server/ad-audience-sync-run', () => ({
  __esModule: true,
  readAdAudienceAccounts: (...args: unknown[]) => mockReadAccounts(...args),
  runAdAudienceSync: (options: unknown) => mockRun(options),
}))

jest.mock('../utils/cron-beat', () => ({
  __esModule: true,
  recordCronBeat: (id: string) => mockBeat(id),
}))

jest.mock('../utils/server/raise-operator-alert', () => ({
  __esModule: true,
  raiseConsoleOperatorAlert: (...args: unknown[]) => mockAlert(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      body: request.method === 'POST' ? await request.json().catch(() => ({})) : undefined,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: Object.fromEntries(
        [...request.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]),
      ),
    }
  },
}))

const { GET, POST } = require('../app/api/admin/ad-audience-sync/route')

const ROUTE = 'https://console.example.test/api/admin/ad-audience-sync'

function call(method: 'GET' | 'POST', token = 'cron-secret', query = '') {
  return new Request(`${ROUTE}${query}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    ...(method === 'POST' ? { body: '{}' } : {}),
  })
}

const report = (outcome: string) => ({
  dryRun: false,
  flagOn: true,
  scanned: 3,
  eligible: 2,
  excluded: {},
  countrySource: { billing: 0, signup: 2 },
  providers: {
    meta: { outcome: 'sent', eligible: 2, previous: 0, toAdd: 2, toRemove: 0 },
    google: { outcome, eligible: 2, previous: 0, toAdd: 2, toRemove: 0, error: 'google answered 401: bad token' },
    linkedin: { outcome: 'unconfigured', eligible: 2, previous: 0, toAdd: 0, toRemove: 0 },
  },
  stages: {
    paid: {
      eligible: 1,
      providers: {
        meta: { outcome: 'unconfigured', eligible: 1, previous: 0, toAdd: 0, toRemove: 0 },
        google: { outcome: 'unconfigured', eligible: 1, previous: 0, toAdd: 0, toRemove: 0 },
        linkedin: { outcome: 'unconfigured', eligible: 1, previous: 0, toAdd: 0, toRemove: 0 },
      },
    },
  },
})

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'cron-secret'
  mockFlagOn = false
  mockReadAccounts.mockResolvedValue({ accounts: [] })
  mockRun.mockImplementation(async (options: { dryRun: boolean }) => ({
    ...report('sent'),
    dryRun: options.dryRun,
  }))
})

describe('/api/admin/ad-audience-sync', () => {
  it('refuses a caller with neither the cron secret nor a token', async () => {
    const response = await POST(call('POST', ''))
    expect(response.status).toBe(401)
    expect(mockReadAccounts).not.toHaveBeenCalled()
  })

  it('refuses a signed-in customer — the route walks every account', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'c', email_verified: true })
    const response = await GET(call('GET', 'customer'))
    expect(response.status).toBe(403)
    expect(mockReadAccounts).not.toHaveBeenCalled()
  })

  it('lets staff read the counts and never send, even on a POST with the flag on', async () => {
    mockFlagOn = true
    mockVerifyIdToken.mockResolvedValue({ uid: 's', email_verified: true, staff: true })
    const response = await POST(call('POST', 'staff', '?force=1'))
    expect(await response.json()).toMatchObject({ dryRun: true })
    expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, force: false }))
    expect(mockBeat).not.toHaveBeenCalled()
  })

  it('a GET with the cron secret is the dry run, whichever way the flag is set', async () => {
    const response = await GET(call('GET'))
    expect(response.status).toBe(200)
    expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, flagOn: false }))
    // Every stage's count rides the report, its lists set or not.
    expect(await response.json()).toMatchObject({ stages: { paid: { eligible: 1 } } })
    // The read is told the operator's domains, so it reads no internal change log.
    expect(mockReadAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ internalDomains: expect.any(Array) }),
    )
  })

  it('the scheduled POST beats, and sends nothing — reads nothing — while the flag is off', async () => {
    const response = await POST(call('POST'))
    expect(await response.json()).toMatchObject({ skipped: 'flag-off', flagOn: false })
    expect(mockBeat).toHaveBeenCalledWith('ad-audience-sync')
    expect(mockReadAccounts).not.toHaveBeenCalled()
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('sends with the flag on, and alerts once per provider that failed', async () => {
    mockFlagOn = true
    mockRun.mockResolvedValue(report('failed'))
    const response = await POST(call('POST', 'cron-secret', '?force=1'))
    expect(response.status).toBe(200)
    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false, flagOn: true, force: true }),
    )
    expect(mockAlert).toHaveBeenCalledTimes(1)
    expect(mockAlert).toHaveBeenCalledWith('ops.adAudienceSyncFailed', {
      dedupeKey: 'ad-audience-sync:google',
      context: { provider: 'Google', detail: 'google answered 401: bad token' },
    })
  })

  it('alerts for a stage list under its own key, naming the list', async () => {
    mockFlagOn = true
    const held = report('sent')
    held.stages.paid.providers.meta = {
      outcome: 'held-shrink',
      eligible: 1,
      previous: 40,
      toAdd: 0,
      toRemove: 39,
      error: 'the audience would shrink from 40 to 1; held until a run with force',
    } as never
    mockRun.mockResolvedValue(held)
    await POST(call('POST'))
    expect(mockAlert).toHaveBeenCalledTimes(1)
    expect(mockAlert).toHaveBeenCalledWith('ops.adAudienceSyncFailed', {
      dedupeKey: 'ad-audience-sync:meta:paid',
      context: {
        provider: 'Meta (paid list)',
        detail: 'the audience would shrink from 40 to 1; held until a run with force',
      },
    })
  })

  it('a failed read sends nothing and says so', async () => {
    mockFlagOn = true
    mockReadAccounts.mockRejectedValue(new Error('deadline exceeded'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await POST(call('POST'))
    spy.mockRestore()
    expect(response.status).toBe(500)
    expect(mockRun).not.toHaveBeenCalled()
    expect(mockAlert).toHaveBeenCalledWith(
      'ops.adAudienceSyncFailed',
      expect.objectContaining({ dedupeKey: 'ad-audience-sync:read' }),
    )
  })
})
