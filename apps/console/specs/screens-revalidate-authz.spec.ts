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
 * AGL-1326: who may drop a site's cached pages through /api/screens/revalidate.
 *
 * The bug this pins was invisible in review because the route's check LOOKED
 * complete — it read `hosts/{hostId}.memberRoles`, which is a real membership
 * map. It is a PROJECTION of the org roster, though, and an org owner who was
 * never added to an individual site does not appear in it, so the person who
 * owns the workspace could not revalidate their own pages and was told the
 * site did not exist.
 *
 * So the load-bearing case here is the org owner with an EMPTY `memberRoles`,
 * and its mirror: an unrelated signed-in user, who must still be refused. A
 * fix that reached for "any signed-in caller" would pass the first and fail
 * the second, which is why they are written together.
 *
 * The last two pin the message rather than the verdict. `hostId` is a doc id
 * while every console URL names a site by subdomain, so the common caller
 * error is sending the subdomain — and answering that with "Unknown site" is
 * what produced two contradictory bug reports off the same 404.
 */

const mockVerifyIdToken = jest.fn()
const mockResolveOrgPermissions = jest.fn()
const mockFetch = jest.fn()

const state: {
  hosts: Record<string, Record<string, unknown>>
} = { hosts: {} }

const hostSnapshot = (id: string) => {
  const data = state.hosts[id]
  return {
    id,
    exists: Boolean(data),
    data: () => data,
    get: (field: string) => (data ?? {})[field],
  }
}

const firestoreFake = {
  collection: (name: string) => ({
    doc: (id: string) => ({ get: async () => hostSnapshot(id) }),
    // Only `hosts.where('subdomain','==',…)` is ever asked — the id→doc miss
    // path. A different query means the route grew a lookup this fake does
    // not describe, and `docs: []` would quietly read as "no such site".
    where: (field: string, op: string, value: unknown) => {
      if (name !== 'hosts' || field !== 'subdomain' || op !== '==') {
        throw new Error(`unexpected query: ${name}.where(${field} ${op})`)
      }
      return {
        limit: () => ({
          get: async () => ({
            docs: Object.keys(state.hosts)
              .filter((id) => state.hosts[id]['subdomain'] === value)
              .map(hostSnapshot),
          }),
        }),
      }
    },
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => firestoreFake,
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  __esModule: true,
  resolveOrgPermissions: (...args: unknown[]) =>
    mockResolveOrgPermissions(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
  screenRoutePathToUrl: (path: string) => path,
  decodeStoredNodes: () => [],
}))

import { POST } from '../app/api/screens/revalidate/route'

const post = (
  body: Record<string, unknown> = {},
  token: string | null = 'tok',
) =>
  POST(
    new Request('https://app.aglyn.com/api/screens/revalidate', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify({ hostId: 'host-1', screenId: 'screen-1', ...body }),
    }),
  )

/** Signed in, verified, and on nobody's roster until a test says otherwise. */
const signedInAs = (uid: string, claims: Record<string, unknown> = {}) =>
  mockVerifyIdToken.mockResolvedValue({ uid, email_verified: true, ...claims })

describe('/api/screens/revalidate authorization (AGL-1326)', () => {
  const previousSecret = process.env['REVALIDATE_SECRET']

  beforeEach(() => {
    jest.clearAllMocks()
    // Without a secret the route short-circuits to `not-configured` BEFORE
    // calling the tenant, and every allowed case would pass without proving
    // the request was actually made.
    process.env['REVALIDATE_SECRET'] = 'secret'
    state.hosts = {
      'host-1': {
        subdomain: 'aglyn-marketing',
        memberRoles: { 'site-editor': 'editor' },
        screens: { 'screen-1': '/pricing' },
      },
    }
    signedInAs('site-editor')
    // The roster answer for someone with no standing anywhere. Tests that are
    // about an org member override it.
    mockResolveOrgPermissions.mockResolvedValue({ hostRole: null })
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ revalidated: ['/pricing'] }),
    })
    global.fetch = mockFetch as unknown as typeof fetch
  })

  afterAll(() => {
    if (previousSecret === undefined) delete process.env['REVALIDATE_SECRET']
    else process.env['REVALIDATE_SECRET'] = previousSecret
  })

  it('401s an unauthenticated caller', async () => {
    const response = await post({}, null)
    expect(response.status).toBe(401)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('revalidates for a host member, without a roster lookup', async () => {
    const response = await post()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ reason: 'ok' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    // The projection is the FAST path: a site member is already the answer,
    // so the org read never happens on the hot publish path.
    expect(mockResolveOrgPermissions).not.toHaveBeenCalled()
  })

  it('revalidates for an org admin with NO memberRoles entry — the bug', async () => {
    // The exact production shape: the workspace owner, absent from the site's
    // projection because nobody ever added them to the site individually.
    state.hosts['host-1']['memberRoles'] = {}
    signedInAs('org-owner')
    mockResolveOrgPermissions.mockResolvedValue({ hostRole: 'admin' })

    const response = await post()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ reason: 'ok' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    // Asked WITH the host in context, so the answer is their role on THIS
    // site. Resolving org-wide instead would let a collaborator scoped to two
    // sites bust the cache of a third.
    expect(mockResolveOrgPermissions).toHaveBeenCalledWith('org-owner', {
      hostId: 'host-1',
    })
  })

  it('404s an unrelated signed-in user rather than revealing the site', async () => {
    state.hosts['host-1']['memberRoles'] = {}
    signedInAs('stranger')
    mockResolveOrgPermissions.mockResolvedValue({ hostRole: null })

    const response = await post()
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Unknown site' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('404s an org VIEWER — reading a site is not publishing one', async () => {
    state.hosts['host-1']['memberRoles'] = {}
    signedInAs('org-viewer')
    mockResolveOrgPermissions.mockResolvedValue({ hostRole: 'viewer' })

    expect((await post()).status).toBe(404)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('404s an unknown host id', async () => {
    const response = await post({ hostId: 'nope' })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Unknown site' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('404s a SUBDOMAIN with a message that says so, and the id to use', async () => {
    const response = await post({ hostId: 'aglyn-marketing' })
    expect(response.status).toBe(404)
    const payload = await response.json()
    expect(payload.reason).toBe('subdomain-not-id')
    expect(payload.error).toContain('subdomain')
    expect(payload.error).toContain('host-1')
    expect(payload.hostId).toBe('host-1')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('tells a subdomain caller nothing when they could not edit the site', async () => {
    // The diagnosis is a courtesy to the site's own editors, never a way to
    // probe which subdomains are taken.
    state.hosts['host-1']['memberRoles'] = {}
    signedInAs('stranger')
    mockResolveOrgPermissions.mockResolvedValue({ hostRole: null })

    const response = await post({ hostId: 'aglyn-marketing' })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Unknown site' })
  })

  it('still lets staff through', async () => {
    state.hosts['host-1']['memberRoles'] = {}
    signedInAs('staff-1', { staff: true })
    const response = await post()
    expect(response.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockResolveOrgPermissions).not.toHaveBeenCalled()
  })
})
