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
 * The getting-started emails (AGL-3692) are system emails like the rest:
 * drawn in the same header, footer and button as `email-verification`, and
 * edited by staff under Staff → Emails like any other catalog email.
 *
 * The two route specs mock the renderer, so neither can see whether a staff
 * design actually reaches a send. This one keeps `renderSystemEmail` real and
 * stores a published design for a getting-started email, then sends it from
 * both places that send one: the hourly sweep and the staff "Send an email"
 * tool on an account's page.
 */

// A module, so these names do not collide with other specs' globals.
export {}

const mockSendEmail = jest.fn()
const mockListUsers = jest.fn()
const mockVerifyIdToken = jest.fn()
const mockFindUser = jest.fn()
/** `systemEmailTemplates/{key}` documents, and their published versions. */
let mockTemplates: Record<string, Record<string, unknown>> = {}
let mockVersions: Record<string, Record<string, unknown>> = {}

// The store the renderer reads the staff design from.
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => {
  const snapshot = (data: Record<string, unknown> | undefined) => ({
    exists: Boolean(data),
    get: (field: string) => data?.[field],
  })
  const firebaseAdmin = {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: (key: string) => ({
            get: async () => snapshot(mockTemplates[key]),
            collection: () => ({
              doc: (versionId: string) => ({
                get: async () => snapshot(mockVersions[`${key}/${versionId}`]),
              }),
            }),
          }),
        }),
      }),
    }),
  }
  return { __esModule: true, default: firebaseAdmin, firebaseAdmin }
})

jest.mock('@aglyn/tenant-data-admin/server/platform-marketing-consent', () => ({
  platformMarketingHostId: () => null,
}))

// What the two routes read: an account with no workspace yet.
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
        auth: () => ({ verifyIdToken: (token: string) => mockVerifyIdToken(token) }),
        firestore: () => ({
          collection: (name: string) => ({
            doc: () => ({
              get: async () => snapshot(name === 'users' ? { firstName: 'Maks' } : null),
              set: async () => undefined,
              collection: () => ({
                limit: () => ({ get: async () => ({ docs: [] }) }),
              }),
            }),
          }),
        }),
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } },
    },
    consumeRateLimit: async () => ({ allowed: true }),
    emailUnverifiedResponse: () => Response.json({ error: 'Verify' }, { status: 403 }),
    findUserByUidAcrossPools: (...args: unknown[]) => mockFindUser(...args),
    isEmailSuppressed: async () => false,
    isImpersonationSession: () => false,
    listUsersAcrossPools: async (...args: unknown[]) => {
      const page = await mockListUsers(...args)
      return {
        users: page.users.map((record: unknown) => ({ record, tenantId: null })),
        nextPageToken: undefined,
      }
    },
    meterPlatformEmail: async () => undefined,
  }
})

jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  __esModule: true,
  addAdminAudit: async () => undefined,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  sendEmail: (options: unknown) => mockSendEmail(options),
}))

jest.mock('../app/api/_lib/auth-action-link', () => ({
  __esModule: true,
  generateAuthActionLink: async () => 'https://app.aglyn.com/verify-email?oobCode=fresh',
}))

jest.mock('../utils/cron-beat', () => ({ __esModule: true, recordCronBeat: async () => undefined }))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn/server'),
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

const { renderSystemEmail } = require('../app/api/_lib/render-system-email')
const sweep = require('../app/api/admin/retention-emails/route')
const staffSend = require('../app/api/admin/users/system-email/route')
const { DOCS_BASE_URL } = require('../constants/docs-links')
const { RETENTION_DOCS_PATHS } = jest.requireActual('@aglyn/shared-util-email')

const NOW = Date.now()
const HOUR = 60 * 60 * 1000

/** A staff design of `retention-build-site`, as the Besigner stores one. */
function publishStaffDesign() {
  mockTemplates = {
    'retention-build-site': {
      versionId: 'v2',
      subject: 'Staff subject for {{name}}',
      preheader: 'Staff preheader',
    },
  }
  mockVersions = {
    'retention-build-site/v2': {
      nodes: {
        '_@_': { $id: '_@_', componentId: 'div', nodes: ['section'] },
        section: {
          $id: 'section',
          componentId: 'emailSection',
          pluginId: 'email',
          parentId: '_@_',
          nodes: ['copy', 'cta'],
        },
        copy: {
          $id: 'copy',
          componentId: 'emailText',
          pluginId: 'email',
          parentId: 'section',
          props: {
            children: 'Staff-written copy for {{name}}. Guide: {{docs.generateSiteUrl}}',
            variant: 'body',
          },
        },
        cta: {
          $id: 'cta',
          componentId: 'emailButton',
          pluginId: 'email',
          parentId: 'section',
          props: { children: 'Staff button', href: '{{ctaUrl}}' },
        },
      },
    },
  }
}

const GUIDE = `${DOCS_BASE_URL}${RETENTION_DOCS_PATHS['docs.generateSiteUrl']}`

function expectStaffDesign(sent: Record<string, unknown>) {
  expect(sent['subject']).toBe('Staff subject for Maks')
  expect(String(sent['html'])).toContain('Staff-written copy for Maks.')
  expect(String(sent['html'])).toContain('Staff button')
  expect(String(sent['html'])).toContain('Staff preheader')
  expect(String(sent['html'])).toContain(`href="${GUIDE}"`)
  // Not the built-in copy.
  expect(String(sent['html'])).not.toContain('Build my site')
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  process.env.CRON_SECRET = 'cron-secret'
  mockTemplates = {}
  mockVersions = {}
  mockSendEmail.mockResolvedValue({ sent: true, id: 'msg' })
  // Confirmed a day ago, and never built a page: owed `retention-build-site`.
  mockListUsers.mockResolvedValue({
    users: [
      {
        uid: 'stalled',
        email: 'stalled@example.com',
        emailVerified: true,
        disabled: false,
        customClaims: {},
        displayName: 'Maks Suwalski',
        metadata: {
          creationTime: new Date(NOW - 30 * HOUR).toUTCString(),
          lastSignInTime: new Date(NOW - 29 * HOUR).toUTCString(),
          lastRefreshTime: null,
        },
      },
    ],
  })
  mockFindUser.mockResolvedValue({
    record: { uid: 'stalled', email: 'stalled@example.com', emailVerified: true },
    tenantId: null,
  })
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email: 'ops@example.com',
    email_verified: true,
    staff: true,
    name: 'Ops',
  })
})

describe('a staff design of a getting-started email', () => {
  it('is what the hourly sweep sends', async () => {
    publishStaffDesign()
    const response = await sweep.POST(
      new Request('https://app.aglyn.com/api/admin/retention-emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer cron-secret' },
        body: '{}',
      }),
    )
    expect(response.status).toBe(200)
    const [[sent]] = mockSendEmail.mock.calls as Array<[Record<string, unknown>]>
    expect(sent).toMatchObject({ to: 'stalled@example.com', context: 'retention-build-site' })
    expectStaffDesign(sent)
  })

  it('is what the staff Send-an-email tool sends', async () => {
    publishStaffDesign()
    const response = await staffSend.POST(
      new Request('https://app.aglyn.com/api/admin/users/system-email', {
        method: 'POST',
        headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: 'stalled', templateKey: 'retention-build-site', send: true }),
      }),
    )
    expect(response.status).toBe(200)
    const [[sent]] = mockSendEmail.mock.calls as Array<[Record<string, unknown>]>
    expect(sent).toMatchObject({ to: 'stalled@example.com', context: 'retention-build-site' })
    expectStaffDesign(sent)
  })

  it('gives way to the built-in copy once staff reset it to the default', async () => {
    publishStaffDesign()
    mockTemplates['retention-build-site'] = { versionId: null, subject: 'Staff subject for {{name}}' }
    await sweep.POST(
      new Request('https://app.aglyn.com/api/admin/retention-emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer cron-secret' },
        body: '{}',
      }),
    )
    const [[sent]] = mockSendEmail.mock.calls as Array<[Record<string, unknown>]>
    expect(sent['subject']).toBe('Your website is a few minutes away')
    expect(String(sent['html'])).toContain('Build my site')
    expect(String(sent['html'])).toContain(`href="${GUIDE}"`)
  })
})

describe('the getting-started emails’ built-in copy', () => {
  /** Every merge token the email declares, at its preview sample. */
  function samples(key: string): Record<string, string> {
    const { getSystemEmailTemplate } = jest.requireActual('@aglyn/shared-util-email')
    return Object.fromEntries(
      getSystemEmailTemplate(key)
        .mergeTokens.filter((token: { name: string }) => !token.name.startsWith('brand.'))
        .map((token: { name: string; sample: string }) => [token.name, token.sample]),
    )
  }

  /** The chrome a render wears: everything but the designed body's rows. */
  function chromeOf(html: string) {
    return {
      logo: /<img [^>]*alt="[^"]*"[^>]*>/.exec(html)?.[0] ?? null,
      button: /<a [^>]*style="(display:inline-block;padding:12px 28px;[^"]*)"/.exec(html)?.[1] ?? null,
      legal: /©[^<]*/.exec(html)?.[0] ?? null,
      help: />Get help</.test(html),
      // The document head, less its title, which is each email's subject.
      head: html.slice(0, html.indexOf('<body')).replace(/<title>[\s\S]*?<\/title>/, ''),
    }
  }

  it('wears the same header, footer, palette and button as the verification email', async () => {
    const reference = await renderSystemEmail('email-verification', samples('email-verification'))
    const referenceChrome = chromeOf(reference.html)
    expect(referenceChrome.button).not.toBeNull()
    for (const key of [
      'retention-verify-reminder',
      'retention-build-site',
      'retention-publish-reminder',
      'retention-next-steps',
      'retention-idle',
    ]) {
      const rendered = await renderSystemEmail(key, samples(key))
      expect(rendered.source).toBe('default')
      expect({ key, ...chromeOf(rendered.html) }).toEqual({ key, ...referenceChrome })
    }
  })
})
