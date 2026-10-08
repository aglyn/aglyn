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
 * The hourly getting-started sweep (AGL-3692). The rules are walked in
 * `retention-emails.spec.ts`; this holds the route to them: cron-only, a GET
 * that sends nothing, a crossing recorded only after its send, and the
 * suppression list and the product email answer honoured at send time.
 */

export {}

const mockListUsers = jest.fn()
const mockSendEmail = jest.fn()
const mockRender = jest.fn()
const mockMintLink = jest.fn()
const mockSuppressed = jest.fn()
const mockUserSet = jest.fn()
let mockUserDocs: Record<string, Record<string, unknown>> = {}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ listUsers: (...args: unknown[]) => mockListUsers(...args) }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => ({
            get: async () => ({
              exists: name === 'users' && Boolean(mockUserDocs[id]),
              data: () => mockUserDocs[id],
              get: (field: string) => mockUserDocs[id]?.[field],
            }),
            set: async (data: unknown, options: unknown) => mockUserSet(name, id, data, options),
            collection: () => ({
              limit: () => ({ get: async () => ({ docs: [] }) }),
            }),
          }),
        }),
      }),
    }),
  },
  isEmailSuppressed: (email: string) => mockSuppressed(email),
  meterPlatformEmail: async () => undefined,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  sendEmail: (options: unknown) => mockSendEmail(options),
}))

jest.mock('../app/api/_lib/render-system-email', () => ({
  __esModule: true,
  renderSystemEmail: (key: string, merge: Record<string, string>) => mockRender(key, merge),
}))

jest.mock('../app/api/_lib/auth-action-link', () => ({
  __esModule: true,
  generateAuthActionLink: (...args: unknown[]) => mockMintLink(...args),
}))

jest.mock('../utils/cron-beat', () => ({ __esModule: true, recordCronBeat: async () => undefined }))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn/app-utils/console-routes'),
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

const { GET, POST } = require('../app/api/admin/retention-emails/route')

const ROUTE = 'https://app.aglyn.com/api/admin/retention-emails'
const NOW = Date.now()
const HOUR = 60 * 60 * 1000

function account(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    uid,
    email: `${uid}@example.com`,
    emailVerified: false,
    disabled: false,
    customClaims: {},
    displayName: 'Maks Suwalski',
    metadata: {
      creationTime: new Date(NOW - 2 * HOUR).toUTCString(),
      lastSignInTime: new Date(NOW - 2 * HOUR).toUTCString(),
      lastRefreshTime: null,
    },
    ...overrides,
  }
}

function call(method: 'GET' | 'POST', authorized = true) {
  return new Request(ROUTE, {
    method,
    headers: authorized ? { Authorization: 'Bearer cron-secret' } : {},
    ...(method === 'POST' ? { body: JSON.stringify({}) } : {}),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'cron-secret'
  mockUserDocs = {}
  mockSuppressed.mockResolvedValue(false)
  mockMintLink.mockResolvedValue('https://app.aglyn.com/verify-email?oobCode=fresh')
  mockRender.mockImplementation(async (key: string, merge: Record<string, string>) => ({
    subject: `subject:${key}`,
    html: '<p>x</p>',
    text: JSON.stringify(merge),
    source: 'default',
  }))
  mockSendEmail.mockResolvedValue({ sent: true, id: 'msg' })
  mockListUsers.mockResolvedValue({ users: [account('fresh')], pageToken: undefined })
})

describe('/api/admin/retention-emails', () => {
  it('refuses a caller without the cron secret', async () => {
    const response = await POST(call('POST', false))
    expect(response.status).toBe(401)
    expect(mockListUsers).not.toHaveBeenCalled()
  })

  it('a GET plans and sends nothing', async () => {
    const response = await GET(call('GET'))
    const body = await response.json()
    expect(body).toMatchObject({ dryRun: true })
    expect(body.rows).toEqual([
      { uid: 'fresh', key: 'retention-verify-reminder', crossing: 'verify-1h', outcome: 'planned' },
    ])
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockMintLink).not.toHaveBeenCalled()
    expect(mockUserSet).not.toHaveBeenCalled()
  })

  it('sends the verification reminder with a fresh link, then records the crossing', async () => {
    const response = await POST(call('POST'))
    expect(response.status).toBe(200)
    const [[sent]] = mockSendEmail.mock.calls as Array<[Record<string, unknown>]>
    expect(sent).toMatchObject({
      to: 'fresh@example.com',
      context: 'retention-verify-reminder',
      priority: 'bulk',
      owedFor: 'account',
    })
    expect(String(sent['text'])).toContain('oobCode=fresh')
    expect(mockUserSet).toHaveBeenCalledWith(
      'users',
      'fresh',
      { lifecycleEmails: { 'verify-1h': expect.any(Number) } },
      { merge: true },
    )
  })

  it('does not send a crossing the account already had', async () => {
    mockUserDocs = { fresh: { lifecycleEmails: { 'verify-1h': NOW - HOUR } } }
    await POST(call('POST'))
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('skips a suppressed address and records nothing', async () => {
    mockSuppressed.mockResolvedValue(true)
    const body = await (await POST(call('POST'))).json()
    expect(body.rows[0]).toMatchObject({ outcome: 'suppressed' })
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockUserSet).not.toHaveBeenCalled()
  })

  it('leaves the crossing open when Identity Platform throttles the link', async () => {
    mockMintLink.mockRejectedValue(
      Object.assign(new Error('An internal error has occurred.'), {
        code: 'auth/internal-error',
        cause: { response: { text: 'TOO_MANY_ATTEMPTS_TRY_LATER' } },
      }),
    )
    const body = await (await POST(call('POST'))).json()
    expect(body.rows[0]).toMatchObject({ outcome: 'throttled' })
    expect(mockUserSet).not.toHaveBeenCalled()
  })

  it('sends a product tip with the way out, and never to someone who said No', async () => {
    const stalled = account('stalled', {
      emailVerified: true,
      metadata: {
        creationTime: new Date(NOW - 30 * HOUR).toUTCString(),
        lastSignInTime: new Date(NOW - 29 * HOUR).toUTCString(),
        lastRefreshTime: null,
      },
    })
    mockListUsers.mockResolvedValue({ users: [stalled], pageToken: undefined })
    await POST(call('POST'))
    const [[sent]] = mockSendEmail.mock.calls as Array<[Record<string, unknown>]>
    expect(sent).toMatchObject({ context: 'retention-build-site' })
    expect((sent['headers'] as Record<string, string>)['List-Unsubscribe']).toContain('/manage/user/emails')

    jest.clearAllMocks()
    mockUserDocs = { stalled: { marketingConsent: false } }
    await POST(call('POST'))
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('never mails staff or disabled accounts', async () => {
    mockListUsers.mockResolvedValue({
      users: [account('staffer', { customClaims: { staff: true } }), account('off', { disabled: true })],
      pageToken: undefined,
    })
    await POST(call('POST'))
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})
