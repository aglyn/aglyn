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
 * The staff "send this account an email" route (AGL-3691).
 *
 * Before it, resending a stranded sign-up its verification link took a
 * script. The gates asserted here are what stand between that convenience and
 * a staff-shaped mailbomb: staff only, catalog emails only, no verification
 * mail to an account that is already verified, no live link at preview, and
 * an audit row on every send.
 */

// A module, so these names do not collide with other specs' globals.
export {}

const mockVerifyIdToken = jest.fn()
const mockFindUser = jest.fn()
const mockSendEmail = jest.fn()
const mockRender = jest.fn()
const mockMintLink = jest.fn()
const mockAuditAdd = jest.fn()
const mockSuppressed = jest.fn()
const mockRateLimit = jest.fn()
const mockMeter = jest.fn()
let mockProfile: Record<string, unknown> = { firstName: 'Maks' }

jest.mock('@aglyn/tenant-data-admin', () => {
  const snapshot = (data: Record<string, unknown> | null) => ({
    exists: Boolean(data),
    data: () => data,
    get: (field: string) => data?.[field],
  })
  return {
    __esModule: true,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
        }),
        firestore: () => ({
          collection: (name: string) => ({
            doc: (id: string) => ({
              get: async () =>
                name === 'orgs'
                  ? snapshot({ name: 'Hydro', slug: 'hydro' })
                  : snapshot(mockProfile),
              collection: () => ({
                limit: () => ({ get: async () => ({ docs: [{ id: 'org-1' }] }) }),
              }),
              id,
            }),
          }),
        }),
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } },
    },
    emailUnverifiedResponse: () =>
      Response.json({ error: 'Verify your email' }, { status: 403 }),
    isImpersonationSession: () => false,
    findUserByUidAcrossPools: (...args: unknown[]) => mockFindUser(...args),
    isEmailSuppressed: (...args: unknown[]) => mockSuppressed(...args),
    consumeRateLimit: (...args: unknown[]) => mockRateLimit(...args),
    meterPlatformEmail: (...args: unknown[]) => mockMeter(...args),
  }
})

jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  __esModule: true,
  addAdminAudit: async (_firestore: unknown, row: unknown) => mockAuditAdd(row),
}))

jest.mock('@aglyn/shared-util-email', () => {
  const actual = jest.requireActual('@aglyn/shared-util-email')
  return {
    __esModule: true,
    ...actual,
    isEmailConfigured: () => true,
    sendEmail: (options: unknown) => mockSendEmail(options),
  }
})

jest.mock('../app/api/_lib/render-system-email', () => ({
  __esModule: true,
  renderSystemEmail: (...args: unknown[]) => mockRender(...args),
}))

jest.mock('../app/api/_lib/auth-action-link', () => ({
  __esModule: true,
  generateAuthActionLink: (...args: unknown[]) => mockMintLink(...args),
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

const { GET, POST } = require('../app/api/admin/users/system-email/route')

const ROUTE = 'https://app.aglyn.com/api/admin/users/system-email'

function post(body: Record<string, unknown>) {
  return new Request(ROUTE, {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function unverifiedTarget() {
  mockFindUser.mockResolvedValue({
    record: { uid: 'target', email: 'Maks@Example.com', emailVerified: false },
    tenantId: null,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockProfile = { firstName: 'Maks' }
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
    name: 'Zach Gover',
  })
  unverifiedTarget()
  mockSuppressed.mockResolvedValue(false)
  mockRateLimit.mockResolvedValue({ allowed: true })
  mockMeter.mockResolvedValue(undefined)
  mockMintLink.mockResolvedValue('https://app.aglyn.com/verify-email?oobCode=fresh')
  mockRender.mockImplementation(async (key: string, merge: Record<string, string>) => ({
    subject: `subject:${key}`,
    html: `<p>${JSON.stringify(merge)}</p>`,
    text: JSON.stringify(merge),
    source: 'default',
  }))
  mockSendEmail.mockResolvedValue({ sent: true, id: 'msg-1' })
})

describe('/api/admin/users/system-email — staff only', () => {
  it('refuses a caller with no token', async () => {
    const response = await POST(
      new Request(ROUTE, { method: 'POST', body: JSON.stringify({}) }),
    )
    expect(response.status).toBe(401)
  })

  it('refuses a signed-in customer, and sends nothing', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'customer', email_verified: true })
    const response = await POST(
      post({ uid: 'target', templateKey: 'email-verification', send: true }),
    )
    expect(response.status).toBe(403)
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockMintLink).not.toHaveBeenCalled()
    expect(mockAuditAdd).not.toHaveBeenCalled()
  })

  it('refuses the list to a customer too', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'customer', email_verified: true })
    const response = await GET(new Request(`${ROUTE}?uid=target`, { headers: { Authorization: 'Bearer tok' } }))
    expect(response.status).toBe(403)
  })
})

describe('/api/admin/users/system-email — which emails', () => {
  it('refuses an unknown email id', async () => {
    const response = await POST(
      post({ uid: 'target', templateKey: 'not-a-real-email', send: true }),
    )
    expect(response.status).toBe(400)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('refuses a Stripe-delivered email and a staff-audience alert', async () => {
    for (const templateKey of ['stripe-receipt', 'staff-alert']) {
      const response = await POST(post({ uid: 'target', templateKey, send: true }))
      expect(response.status).toBe(400)
    }
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('lists the follow-up and the auth emails, with the account filled in', async () => {
    const response = await GET(new Request(`${ROUTE}?uid=target`, { headers: { Authorization: 'Bearer tok' } }))
    expect(response.status).toBe(200)
    const body = await response.json()
    const keys = body.emails.map((entry: { key: string }) => entry.key)
    expect(keys).toEqual(expect.arrayContaining(['staff-follow-up', 'email-verification', 'password-reset', 'welcome']))
    expect(keys).not.toContain('staff-alert')
    const welcome = body.emails.find((entry: { key: string }) => entry.key === 'welcome')
    expect(welcome.values).toMatchObject({ name: 'Maks', 'org.name': 'Hydro' })
    expect(body.account).toMatchObject({ email: 'maks@example.com', emailVerified: false })
  })
})

describe('/api/admin/users/system-email — verification', () => {
  it('skips an account that is already verified, minting and sending nothing', async () => {
    mockFindUser.mockResolvedValue({
      record: { uid: 'target', email: 'maks@example.com', emailVerified: true },
      tenantId: null,
    })
    const response = await POST(
      post({ uid: 'target', templateKey: 'email-verification', send: true }),
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ alreadyVerified: true })
    expect(mockMintLink).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('previews with a placeholder link — no mint, no send', async () => {
    const response = await POST(post({ uid: 'target', templateKey: 'email-verification' }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ preview: true, sent: false, subject: 'subject:email-verification' })
    expect(body.html).not.toContain('oobCode')
    expect(mockMintLink).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('mints a fresh link at send, sends under the email’s own context, meters and audits', async () => {
    const response = await POST(
      post({
        uid: 'target',
        templateKey: 'email-verification',
        // A typed link is ignored: the link is the server's to mint.
        mergeValues: { verifyUrl: 'https://evil.example/' },
        send: true,
      }),
    )
    expect(response.status).toBe(200)
    expect(mockMintLink).toHaveBeenCalledWith('verifyEmail', 'maks@example.com', expect.any(String))
    const [[sent]] = mockSendEmail.mock.calls as Array<[Record<string, string>]>
    expect(sent).toMatchObject({ to: 'maks@example.com', context: 'email-verification' })
    expect(sent.text).toContain('oobCode=fresh')
    expect(sent.text).not.toContain('evil.example')
    expect(mockMeter).toHaveBeenCalledTimes(1)
    expect(mockAuditAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUid: 'staff-1',
        action: 'systemEmail.staffSend',
        target: 'users/target',
        subjectUid: 'target',
      }),
    )
  })

  it('answers 429 when Identity Platform throttles the mint', async () => {
    mockMintLink.mockRejectedValue(
      Object.assign(new Error('An internal error has occurred.'), {
        code: 'auth/internal-error',
        cause: { response: { text: '{"error":{"message":"TOO_MANY_ATTEMPTS_TRY_LATER"}}' } },
      }),
    )
    const response = await POST(
      post({ uid: 'target', templateKey: 'email-verification', send: true }),
    )
    expect(response.status).toBe(429)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

describe('/api/admin/users/system-email — refusals before a send', () => {
  it('refuses a suppressed address', async () => {
    mockSuppressed.mockResolvedValue(true)
    const response = await POST(post({ uid: 'target', templateKey: 'welcome', send: true }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ suppressed: true })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('refuses past the per-account hourly limit', async () => {
    mockRateLimit.mockResolvedValue({ allowed: false })
    const response = await POST(post({ uid: 'target', templateKey: 'welcome', send: true }))
    expect(response.status).toBe(429)
    expect(mockRateLimit).toHaveBeenCalledWith('staff-system-email:target', expect.any(Object))
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

describe('/api/admin/users/system-email — written follow-up', () => {
  it('needs a subject and a message', async () => {
    const response = await POST(
      post({ uid: 'target', templateKey: 'staff-follow-up', mergeValues: { 'message.body': 'hi' } }),
    )
    expect(response.status).toBe(400)
  })

  it('sends with Reply-To set to the staffer and their name signed', async () => {
    const response = await POST(
      post({
        uid: 'target',
        templateKey: 'staff-follow-up',
        mergeValues: { 'message.subject': 'Your site', 'message.body': 'Need a hand?' },
        send: true,
      }),
    )
    expect(response.status).toBe(200)
    const [[sent]] = mockSendEmail.mock.calls as Array<[Record<string, string>]>
    expect(sent).toMatchObject({ context: 'staff-follow-up', replyTo: 'ops@aglyn.com' })
    expect(mockRender).toHaveBeenLastCalledWith(
      'staff-follow-up',
      expect.objectContaining({ 'sender.name': 'Zach', name: 'Maks' }),
    )
  })
})

describe('/api/admin/users/system-email — getting-started tips (AGL-3692)', () => {
  it('lists the retention emails too', async () => {
    const response = await GET(new Request(`${ROUTE}?uid=target`, { headers: { Authorization: 'Bearer tok' } }))
    const keys = (await response.json()).emails.map((entry: { key: string }) => entry.key)
    expect(keys).toEqual(expect.arrayContaining(['retention-build-site', 'retention-verify-reminder']))
  })

  it('refuses a product tip to an account that turned product email off', async () => {
    mockProfile = { firstName: 'Maks', marketingConsent: false }
    const response = await POST(post({ uid: 'target', templateKey: 'retention-build-site', send: true }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ declinedProductEmail: true })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('sends a product tip with List-Unsubscribe pointing at the switch', async () => {
    const response = await POST(post({ uid: 'target', templateKey: 'retention-build-site', send: true }))
    expect(response.status).toBe(200)
    const [[sent]] = mockSendEmail.mock.calls as Array<[Record<string, any>]>
    expect(sent.headers['List-Unsubscribe']).toContain('/manage/user/emails')
  })
})
