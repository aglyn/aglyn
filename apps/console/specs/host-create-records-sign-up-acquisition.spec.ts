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

import { hasOrgPermission as mockHasOrgPermission } from '@aglyn/aglyn'

/**
 * The site door is a sign-up acquisition backstop too (AGL-3706).
 *
 * "Create your first site" provisions a brand-new account's workspace inside
 * `/api/hosts/create`, through `ensureOrgForUser`, and the workspace copies
 * its creator's acquisition record at birth. Only `/api/orgs/create` asked
 * the writer first, so a Google sign-up on auth.aglyn.com whose page never
 * sent its record (2026-10-09, org YIZ2pYQehD) got a workspace stamped
 * `unknown`. These cases pin that this door asks too, asks before the
 * workspace, and never lets the answer cost the site.
 */

const mockVerifyIdToken = jest.fn()
const mockEnsureOrgForUser = jest.fn()
const mockResolveOrgMembership = jest.fn()
const mockAnnounceNewWorkspace = jest.fn()
const mockAnnounceNewSite = jest.fn()
const mockRecordSignUpAcquisition = jest.fn()
const mockSteps: string[] = []

/** A subcollection whose documents carry a path, and nest further. */
function mockSubcollection(path: string): unknown {
  return {
    doc: (id: string) => ({
      path: `${path}/${id}`,
      collection: (sub: string) => mockSubcollection(`${path}/${id}/${sub}`),
    }),
  }
}

const ORG = { $id: 'org-1', slug: 'dongare', name: 'Dongare Enterprises', plan: 'free' }

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  ensureHostSendingDomain: async () => ({
    domain: null,
    label: null,
    created: false,
    error: null,
  }),
  firebaseAdmin: {
    firestore: {
      FieldValue: { serverTimestamp: () => 'ts', delete: () => 'delete' },
    },
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => ({
          where: () => ({
            limit: () => ({ get: async () => ({ empty: true, docs: [] }) }),
            count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
          }),
          doc: (id: string) => ({
            path: `${name}/${id}`,
            get: async () => ({
              exists: true,
              data: () => ORG,
              get: (field: string) => (ORG as Record<string, unknown>)[field],
            }),
            collection: (sub: string) => mockSubcollection(`${name}/${id}/${sub}`),
          }),
        }),
        runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            get: async (target: { path?: string }) => {
              if (!target?.path) return { docs: [] }
              return {
                exists: true,
                data: () => ORG,
                get: (field: string) =>
                  field === 'hosts' ? {} : (ORG as Record<string, unknown>)[field],
                ref: target,
              }
            },
            set: () => undefined,
          }),
      }),
    }),
  },
  consumeRateLimit: async () => ({
    allowed: true,
    limit: 20,
    remaining: 19,
    resetMs: Date.now() + 3_600_000,
    degraded: false,
  }),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  ensureOrgForUser: (...args: unknown[]) => {
    mockSteps.push('workspace')
    return mockEnsureOrgForUser(...args)
  },
  freeWorkspaceCapRefusalResponse: () => null,
  isImpersonationSession: (decoded: Record<string, unknown>) =>
    typeof decoded['impersonatedBy'] === 'string',
  logHostActivity: async () => undefined,
  registerOrgHost: async () => undefined,
  lockdownRefusal: async () => null,
  memberHasOrgPermission: async (
    _orgId: string,
    member: Record<string, unknown> | null | undefined,
    permission: string,
  ) => mockHasOrgPermission(member as never, permission as never, null),
  resolveOrgMembership: (...args: unknown[]) => mockResolveOrgMembership(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
      cookie: request.headers.get('cookie') ?? undefined,
      host: 'app.aglyn.com',
    },
  }),
  resolveIdpDisplayName: () => 'Dongare Enterprises',
  checkQuota: () => ({ allowed: true, limit: 1 }),
  createResourceUid: () => 'host-new',
  isBlockedSubdomain: () => false,
  SUBDOMAIN_PATTERN: /^[a-z0-9-]{3,30}$/,
  suggestSubdomains: () => [],
}))

jest.mock('@aglyn/tenant-data-admin/server/account-acquisition', () => ({
  __esModule: true,
  recordSignUpAcquisition: (...args: unknown[]) => {
    mockSteps.push('acquisition')
    return mockRecordSignUpAcquisition(...args)
  },
}))

jest.mock('../app/api/_lib/growth-announcements', () => ({
  __esModule: true,
  announceNewWorkspace: (...args: unknown[]) => mockAnnounceNewWorkspace(...args),
  announceNewSite: (...args: unknown[]) => mockAnnounceNewSite(...args),
}))

import { POST } from '../app/api/hosts/create/route'

const TOUCH = { v: 1, at: 1, host: 'example.com', path: '/create-a-website', ref: 'www.google.com' }

const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  POST(
    new Request('https://app.aglyn.com/api/hosts/create', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', ...headers },
      body: JSON.stringify({ displayName: 'Paperlink', subdomain: 'paperlink', ...body }),
    }),
  )

const googleToken = (extra: Record<string, unknown> = {}) => ({
  uid: 'u-google',
  email: 'ada@example.com',
  email_verified: true,
  firebase: { sign_in_provider: 'google.com' },
  ...extra,
})

beforeEach(() => {
  jest.clearAllMocks()
  mockSteps.length = 0
  mockVerifyIdToken.mockResolvedValue(googleToken())
  mockEnsureOrgForUser.mockResolvedValue({
    orgId: 'org-1',
    member: { role: 'owner' },
    created: true,
  })
  mockResolveOrgMembership.mockResolvedValue({
    orgId: 'org-1',
    member: { role: 'owner' },
  })
  mockRecordSignUpAcquisition.mockResolvedValue({ status: 'recorded' })
  mockAnnounceNewWorkspace.mockResolvedValue(undefined)
  mockAnnounceNewSite.mockResolvedValue(undefined)
})

describe('AGL-3706 · a first site records a missing sign-up acquisition before its workspace', () => {
  it("asks the writer, with the verified provider and the page's touch, BEFORE the workspace", async () => {
    const response = await post({ touch: TOUCH })

    expect(response.status).toBe(200)
    expect(mockSteps).toEqual(['acquisition', 'workspace'])
    expect(mockRecordSignUpAcquisition).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'u-google',
        provider: 'google.com',
        email: 'ada@example.com',
        touch: TOUCH,
      }),
    )
  })

  it('falls back to the first-touch cookie when the page sent none', async () => {
    const cookie = `aglyn_ft=${encodeURIComponent(JSON.stringify(TOUCH))}`
    await post({}, { cookie })

    expect(mockRecordSignUpAcquisition).toHaveBeenCalledWith(
      expect.objectContaining({ touch: TOUCH }),
    )
  })

  it('still creates the site when the record cannot be written', async () => {
    mockRecordSignUpAcquisition.mockRejectedValue(new Error('firestore down'))
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await post({ touch: TOUCH })

    expect(response.status).toBe(200)
    expect(mockEnsureOrgForUser).toHaveBeenCalled()
    quiet.mockRestore()
  })

  it('asks nothing when the site goes into a named workspace, which already exists', async () => {
    await post({ orgId: 'org-1', touch: TOUCH })

    expect(mockRecordSignUpAcquisition).not.toHaveBeenCalled()
  })

  it('asks nothing for a staff member acting as somebody', async () => {
    mockVerifyIdToken.mockResolvedValue(googleToken({ impersonatedBy: 'staff-1' }))

    await post({ touch: TOUCH })

    expect(mockRecordSignUpAcquisition).not.toHaveBeenCalled()
  })
})
