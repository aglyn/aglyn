/**
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
 *
 * @jest-environment node
 */

/**
 * Deleting a dataset through /api/resources/erase answers by where it is placed
 * (AGL-4047), and a refusal calls nothing: `eraseSubtree` is `recursiveDelete`,
 * so a check that runs after it has already run is not a check.
 *
 * The real `eraseScopeDenial`, the real placement verdict and real scope tokens
 * are wired in; only the Firestore and token fakes are not.
 */

const mockEraseSubtree = jest.fn()
const mockVerifyIdToken = jest.fn()

const ORG = 'org-1'
const HOST = 'host-1'

const state: {
  member: Record<string, unknown> | null
  dataset: Record<string, unknown> | null
  host: Record<string, unknown> | null
} = { member: null, dataset: null, host: null }

const snapshotOf = (data: Record<string, unknown> | null) => ({
  exists: data !== null,
  data: () => data ?? undefined,
  get: (field: string) => (data ?? {})[field],
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: () => ({
            get: async () => snapshotOf(name === 'hosts' ? state.host : {}),
            collection: () => ({ doc: () => ({ get: async () => snapshotOf(state.dataset) }) }),
          }),
        }),
      }),
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'Verify' }, { status: 403 }),
  eraseSubtree: (...args: unknown[]) => mockEraseSubtree(...args),
  isImpersonationSession: () => false,
  lockdownRefusal: async () => null,
  memberHasOrgPermission: async (_orgId: string, member: unknown, permission: string) =>
    Boolean(
      (
        jest.requireActual('@aglyn/aglyn/app-utils/org-permissions') as {
          resolveOrgPermissions: (member: unknown) => Record<string, boolean>
        }
      ).resolveOrgPermissions(member)[permission],
    ),
  permissionRefusal: (permission: string) => Response.json({ reason: 'permission', permission }, { status: 403 }),
  resolveOrgMembership: async () => (state.member ? { member: state.member } : null),
}))

jest.mock('../app/api/_lib/invalid-id-token-response', () => ({ invalidIdTokenResponse: () => null }))

import { projectMemberScopeTokens } from '@aglyn/aglyn/app-utils/organizations'
import { registerPluginEntitlements } from '@aglyn/aglyn/plugin-manager/plugin-entitlements'
import { POST } from '../app/api/resources/erase/route'

const seated = (member: Record<string, unknown>) => ({ ...member, scopeTokens: projectMemberScopeTokens(member as never) })
const erase = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request('https://console.test/api/resources/erase', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'orgs', scopeId: ORG, kind: 'datasets', id: 'd-1', ...extra }),
    }),
  )
const place = (visibleTo: string[]) => {
  state.dataset = { displayName: 'Menu', visibleTo }
}
const siteStamp = (role: string, stamp?: boolean) => {
  state.host = {
    orgId: ORG,
    memberRoles: { 'uid-1': role },
    ...(stamp === undefined ? {} : { memberPermissions: { 'uid-1': { 'data.siteDelete': stamp } } }),
  }
}
const SITE_ONLY_HOLDER = { role: 'viewer', allHosts: false, hostAccess: { [HOST]: 'viewer' }, permissions: { 'org.eraseRecords': true } }

beforeAll(() => {
  registerPluginEntitlements({
    pluginId: 'data',
    orgPermissions: [
      {
        key: 'data.siteDelete',
        label: 'Delete this site’s datasets',
        roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
        hostRoleDefaults: { admin: true, editor: true, author: false, viewer: false },
        follows: 'org.eraseRecords',
        narrowsPerSite: { editor: true },
        raisesPerSite: true,
      },
    ],
  })
})

beforeEach(() => {
  mockEraseSubtree.mockReset().mockResolvedValue(undefined)
  mockVerifyIdToken.mockReset().mockResolvedValue({ uid: 'uid-1', email_verified: true })
  state.member = null
  state.dataset = null
  state.host = null
})

describe('a site-only holder of "Delete workspace records"', () => {
  it.each([
    ['every site', ['org']],
    ['several sites', [`host:${HOST}`, 'host:2']],
  ])('%s: refused whether or not the request names a site, and nothing is deleted', async (_placement, visibleTo) => {
    state.member = seated(SITE_ONLY_HOLDER)
    place(visibleTo)
    for (const extra of [{}, { hostId: HOST }]) {
      const response = await erase(extra)
      expect(response.status).toBe(403)
      expect((await response.json()).error).toContain('takes access to every site')
    }
    expect(mockEraseSubtree).not.toHaveBeenCalled()
  })

  it('still deletes a dataset placed on their own site, which the key decides', async () => {
    state.member = seated(SITE_ONLY_HOLDER)
    place([`host:${HOST}`])
    siteStamp('viewer', false)
    expect((await erase({ hostId: HOST })).status).toBe(200)
    expect(mockEraseSubtree).toHaveBeenCalledTimes(1)
  })

  it('gets a 404 for one placed where they cannot see', async () => {
    state.member = seated(SITE_ONLY_HOLDER)
    place(['host:2'])
    expect((await erase()).status).toBe(404)
    expect(mockEraseSubtree).not.toHaveBeenCalled()
  })
})

describe('a member of the whole workspace', () => {
  it('deletes what the workspace shares, from the workspace page, and is pointed there from a site', async () => {
    state.member = seated({ role: 'editor', allHosts: true })
    place(['org'])
    expect((await erase({ hostId: HOST })).status).toBe(409)
    expect(mockEraseSubtree).not.toHaveBeenCalled()
    expect((await erase()).status).toBe(200)
    expect(mockEraseSubtree).toHaveBeenCalledTimes(1)
  })

  it('is refused, naming the permission, without "Delete workspace records"', async () => {
    state.member = seated({ role: 'viewer', allHosts: true })
    place(['org'])
    const response = await erase()
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ permission: 'org.eraseRecords' })
    expect(mockEraseSubtree).not.toHaveBeenCalled()
  })

  it('an editor narrowed on the one site it sits on loses it there, naming the site’s permission', async () => {
    state.member = seated({ role: 'editor', allHosts: true, hostAccess: { [HOST]: 'author' } })
    place([`host:${HOST}`])
    siteStamp('author', false)
    const response = await erase({ hostId: HOST })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ permission: 'data.siteDelete' })
    expect(mockEraseSubtree).not.toHaveBeenCalled()
  })

  it('that editor keeps it where the stamp says they keep it, and on a shared dataset', async () => {
    state.member = seated({ role: 'editor', allHosts: true, hostAccess: { [HOST]: 'author' } })
    place([`host:${HOST}`])
    siteStamp('author', true)
    expect((await erase({ hostId: HOST })).status).toBe(200)
    place(['org'])
    expect((await erase()).status).toBe(200)
  })
})

describe('a site’s Admin or Editor on the viewer role', () => {
  it.each(['admin', 'editor'])('a site %s deletes the dataset placed on that site alone', async (siteRole) => {
    state.member = seated({ role: 'viewer', allHosts: false, hostAccess: { [HOST]: siteRole } })
    place([`host:${HOST}`])
    siteStamp(siteRole)
    expect((await erase({ hostId: HOST })).status).toBe(200)
  })

  it.each(['author', 'viewer'])('a site %s does not', async (siteRole) => {
    state.member = seated({ role: 'viewer', allHosts: false, hostAccess: { [HOST]: siteRole } })
    place([`host:${HOST}`])
    siteStamp(siteRole)
    expect((await erase({ hostId: HOST })).status).toBe(403)
    expect(mockEraseSubtree).not.toHaveBeenCalled()
  })

  it('and a missing dataset is no way past the key', async () => {
    state.member = seated({ role: 'viewer', allHosts: true })
    state.dataset = null
    expect((await erase()).status).toBe(403)
    expect(mockEraseSubtree).not.toHaveBeenCalled()
  })
})

describe('the other kinds', () => {
  it('a list stays on "Delete workspace records" alone, for a site-only holder too', async () => {
    state.member = seated(SITE_ONLY_HOLDER)
    state.dataset = { visibleTo: ['org'] }
    expect((await erase({ kind: 'lists' })).status).toBe(200)
    state.member = seated({ role: 'viewer', allHosts: true })
    expect((await erase({ kind: 'lists' })).status).toBe(403)
  })
})
