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
 * AGL-3491: staff hears about a new site, and about the workspace a first
 * site creates.
 *
 * `/api/hosts/create` provisions a personal workspace through
 * `ensureOrgForUser` for an account that holds none — the door a brand-new
 * account most often takes — and it announced nothing, because the welcome
 * email and the staff notice lived inline in `/api/orgs/create`. The route
 * is driven here with the shared announcer mocked, so what is asserted is
 * which announcements the door raises.
 */

const mockVerifyIdToken = jest.fn()
const mockEnsureOrgForUser = jest.fn()
const mockResolveOrgMembership = jest.fn()
const mockAnnounceNewWorkspace = jest.fn()
const mockAnnounceNewSite = jest.fn()

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
  ensureOrgForUser: (...args: unknown[]) => mockEnsureOrgForUser(...args),
  freeWorkspaceCapRefusalResponse: () => null,
  isImpersonationSession: () => false,
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

jest.mock('../app/api/_lib/growth-announcements', () => ({
  __esModule: true,
  announceNewWorkspace: (...args: unknown[]) => mockAnnounceNewWorkspace(...args),
  announceNewSite: (...args: unknown[]) => mockAnnounceNewSite(...args),
}))

import { POST } from '../app/api/hosts/create/route'

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://app.aglyn.com/api/hosts/create', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ displayName: 'Paperlink', subdomain: 'paperlink', ...body }),
    }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-new',
    email: 'owner@example.com',
    email_verified: true,
  })
  mockAnnounceNewWorkspace.mockResolvedValue(undefined)
  mockAnnounceNewSite.mockResolvedValue(undefined)
})

describe('AGL-3491 · /api/hosts/create announces what it creates', () => {
  it('a first site that provisions a workspace announces the workspace AND the site', async () => {
    mockEnsureOrgForUser.mockResolvedValue({
      orgId: 'org-1',
      member: { role: 'owner' },
      created: true,
    })

    const response = await post({})

    expect(response.status).toBe(200)
    expect(mockAnnounceNewWorkspace).toHaveBeenCalledTimes(1)
    expect(mockAnnounceNewWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        name: 'Dongare Enterprises',
        slug: 'dongare',
        owner: { uid: 'u-new', email: 'owner@example.com', displayName: 'Dongare Enterprises' },
        origin: 'https://app.aglyn.com',
      }),
    )
    expect(mockAnnounceNewSite).toHaveBeenCalledWith({
      hostId: 'host-new',
      displayName: 'Paperlink',
      subdomain: 'paperlink',
      orgSlug: 'dongare',
      createdBy: 'owner@example.com',
    })
  })

  it('a site in a workspace that already existed announces only the site', async () => {
    mockEnsureOrgForUser.mockResolvedValue({ orgId: 'org-1', member: { role: 'owner' } })

    const response = await post({})

    expect(response.status).toBe(200)
    expect(mockAnnounceNewWorkspace).not.toHaveBeenCalled()
    expect(mockAnnounceNewSite).toHaveBeenCalledTimes(1)
  })

  it('a site created in a named workspace never announces a workspace', async () => {
    mockResolveOrgMembership.mockResolvedValue({ orgId: 'org-1', member: { role: 'owner' } })

    const response = await post({ orgId: 'org-1' })

    expect(response.status).toBe(200)
    expect(mockEnsureOrgForUser).not.toHaveBeenCalled()
    expect(mockAnnounceNewWorkspace).not.toHaveBeenCalled()
    expect(mockAnnounceNewSite).toHaveBeenCalledTimes(1)
  })

  it('a refused create announces nothing', async () => {
    mockResolveOrgMembership.mockResolvedValue(null)

    const response = await post({ orgId: 'org-elsewhere' })

    expect(response.status).toBe(403)
    expect(mockAnnounceNewWorkspace).not.toHaveBeenCalled()
    expect(mockAnnounceNewSite).not.toHaveBeenCalled()
  })
})
