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
 * A marketplace plugin installed for every site but some (AGL-4047).
 *
 * The route leaves the chosen sites out (the same entry each site's own Admin ›
 * Plugins switch writes) BEFORE it writes the workspace's pin, and only after
 * every check that can refuse the install has passed: so a site left out never
 * runs the plugin, and a refused install leaves no entry behind. Leaving a site
 * out takes "Manage site settings" there; one refusal writes nothing.
 */

jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('@aglyn/aglyn/server'),
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    orgId: 'buyer-org',
    permissions: { installPlugins: true },
  }),
}))

jest.mock('./publisher-profile', () => ({ isPublisherMember: async () => false }))
jest.mock('./purchase-entitlement', () => ({ requirePurchase: async () => undefined }))
jest.mock('./provenance', () => ({ pinnedProvenance: () => ({ listingId: 'listing-1' }) }))
jest.mock('./version-stats', () => ({ recordVersionMove: async () => undefined }))

/** Everything the route wrote, in order. */
const mockEvents: string[] = []
const mockRunsOnCalls: Array<Record<string, unknown>> = []
const mockRunsOn = {
  answer: { ok: true, leftOutHostIds: ['h2'], broughtBackHostIds: [] } as Record<string, unknown>,
}
const mockSiteAsks: Array<{ hostId: string; permission: string; member: unknown }> = []

jest.mock('@aglyn/tenant-data-admin/server/plugin-runs-on', () => ({
  ...jest.requireActual('@aglyn/tenant-data-admin/server/plugin-runs-on'),
  writePluginRunsOn: async (options: Record<string, unknown>) => {
    mockRunsOnCalls.push(options)
    const mayChangeSite = options['mayChangeSite'] as (hostId: string) => Promise<boolean>
    await mayChangeSite('h2')
    mockEvents.push('runs-on')
    return mockRunsOn.answer
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const state = { listing: {} as Record<string, unknown> }
  const version = {
    reviewState: 'approved',
    sha256: 'sha',
    objectPath: 'path',
    manifest: { id: 'com.example.plugin' },
    publishedAt: { toMillis: () => 1 },
  }
  const versionsCollection = {
    doc: () => ({ get: async () => ({ exists: true, data: () => version }) }),
    orderBy: () => ({
      limit: () => ({
        get: async () => ({
          docs: [{ id: '1.0.0', get: (field: string) => (version as any)[field], data: () => version }],
        }),
      }),
    }),
  }
  const installDoc = {
    get: async () => ({ exists: false, get: () => undefined }),
    set: async () => {
      mockEvents.push('pin')
    },
  }
  const hostRef = {
    get: async () => ({
      exists: true,
      get: (field: string) => (field === 'memberRoles' ? { 'buyer-1': 'admin' } : undefined),
    }),
    collection: () => ({ doc: () => installDoc }),
  }
  const listingRef = {
    get: async () => ({
      data: () => ({
        profileId: 'seller-org',
        artifactType: 'plugin',
        reviewStatus: 'listed',
        displayName: 'Promo Countdown',
        priceUsd: 0,
        latestVersion: '1.0.0',
        latestApprovedVersion: '1.0.0',
        ...state.listing,
      }),
    }),
    collection: () => versionsCollection,
    update: async () => undefined,
  }
  const firestore = {
    collection: (name: string) => {
      if (name === 'hosts') return { doc: () => hostRef }
      if (name === 'marketplaceListings') return { doc: () => listingRef }
      if (name === 'revocations') return { doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }) }
      if (name === 'orgs') {
        return {
          doc: () => ({
            get: async () => ({ get: () => undefined, data: () => undefined }),
            collection: () => ({ doc: () => installDoc }),
          }),
        }
      }
      throw new Error(`unexpected collection: ${name}`)
    },
  }
  return {
    __state: state,
    resolveOrgIdForHost: async () => 'buyer-org',
    resolveOrgMembership: async () => ({ orgId: 'buyer-org', member: { role: 'admin', uid: 'buyer-1' } }),
    memberHasPermissionOnHost: async (
      _orgId: string,
      hostId: string,
      member: unknown,
      permission: string,
    ) => {
      mockSiteAsks.push({ hostId, permission, member })
      return true
    },
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'buyer-1' }) }),
        firestore: () => firestore,
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'NOW', increment: (by: number) => by } },
    },
  }
})

import { installPluginHandler } from './install-plugin'

const state = (jest.requireMock('@aglyn/tenant-data-admin') as {
  __state: { listing: Record<string, unknown> }
}).__state

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined as any,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res
}

const install = async (body: Record<string, unknown>) => {
  const res = makeRes()
  await installPluginHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { listingId: 'listing-1', hostId: 'h1', ...body },
    } as any,
    res,
  )
  return res
}

const EXCEPT = { mode: 'allExcept', exceptHostIds: ['h2'] }

beforeEach(() => {
  mockEvents.length = 0
  mockRunsOnCalls.length = 0
  mockSiteAsks.length = 0
  mockRunsOn.answer = { ok: true, leftOutHostIds: ['h2'], broughtBackHostIds: [] }
  for (const key of Object.keys(state.listing)) delete state.listing[key]
})

describe('installing a plugin for every site but some', () => {
  it('leaves the sites out first, then pins it for the workspace', async () => {
    const res = await install({ scope: 'org', runsOn: EXCEPT })
    expect(res.statusCode).toBe(200)
    expect(mockEvents).toEqual(['runs-on', 'pin'])
    expect(res.body).toMatchObject({ installed: true, leftOutHostIds: ['h2'] })
    expect(mockRunsOnCalls[0]).toMatchObject({
      orgId: 'buyer-org',
      pluginId: 'listing-1',
      label: 'Promo Countdown',
      installing: true,
      choice: EXCEPT,
    })
  })

  it('asks "Manage site settings" of the member on each site it leaves out', async () => {
    await install({ scope: 'org', runsOn: EXCEPT })
    expect(mockSiteAsks).toEqual([
      { hostId: 'h2', permission: 'site.manage', member: { role: 'admin', uid: 'buyer-1' } },
    ])
  })

  it('a site that refuses writes no pin, and the reason reaches the member', async () => {
    mockRunsOn.answer = { ok: false, status: 403, problem: 'On Cafe: you need Manage site settings.' }
    const res = await install({ scope: 'org', runsOn: EXCEPT })
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: 'On Cafe: you need Manage site settings.' })
    expect(mockEvents).toEqual(['runs-on'])
  })

  it('a refused install leaves no site out', async () => {
    state.listing['reviewStatus'] = 'rejected'
    const res = await install({ scope: 'org', runsOn: EXCEPT })
    expect(res.statusCode).toBe(409)
    expect(mockEvents).toEqual([])
  })

  it('refuses leaving sites out of a one-site install, or anything but "all sites except"', async () => {
    for (const body of [
      { runsOn: EXCEPT },
      { scope: 'org', runsOn: { mode: 'all' } },
      { scope: 'org', runsOn: { mode: 'selected', hostIds: ['h1'] } },
      { scope: 'org', runsOn: { mode: 'allExcept', exceptHostIds: ['hosts/h2'] } },
    ]) {
      const res = await install(body)
      expect(res.statusCode).toBe(400)
      expect(res.body).toEqual({ error: 'Only an install for every site can leave sites out.' })
    }
    expect(mockEvents).toEqual([])
  })

  it('an ordinary install writes no site entry (the control)', async () => {
    const res = await install({ scope: 'org' })
    expect(res.statusCode).toBe(200)
    expect(mockEvents).toEqual(['pin'])
    expect(res.body.leftOutHostIds).toBeUndefined()
  })
})
