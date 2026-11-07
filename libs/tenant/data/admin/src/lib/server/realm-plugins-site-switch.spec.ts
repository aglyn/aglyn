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
 */

/**
 * A site's own Admin › Plugins switch stops a marketplace plugin there
 * (AGL-4047).
 *
 * The switch writes the listing id into the host's `disabledPlugins`. The join
 * every realm consumer reads (the published page's bundles, its function
 * bindings, the Besigner's element list, the connection readers) read only the
 * workspace's list, so a plugin a site turned off kept running on it. The
 * double returns only the projected fields, as Firestore does, so the specs
 * also fail if the host read stops being masked.
 */

const mockDocs = new Map<string, Record<string, unknown>>()
const mockInstalls = new Map<string, string[]>()
const mockMasks: Array<{ path: string; fieldMask: string[] }> = []
const mockCacheCalls: Array<{ key: string[]; tags: string[] }> = []
let mockHostReadFails = false

const mockSnapshot = (id: string, data: Record<string, unknown> | undefined) => ({
  id,
  exists: Boolean(data),
  data: () => data,
  get: (field: string) => data?.[field],
})

const mockPick = (data: Record<string, unknown>, fields: readonly string[]) =>
  Object.fromEntries(fields.filter((f) => f in data).map((f) => [f, data[f]]))

jest.mock('./firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        getAll: async (
          ref: { path: string; id: string },
          options: { fieldMask: string[] },
        ) => {
          mockMasks.push({ path: ref.path, fieldMask: options.fieldMask })
          if (mockHostReadFails && ref.path.startsWith('hosts/')) {
            throw new Error('unavailable')
          }
          const stored = mockDocs.get(ref.path)
          return [mockSnapshot(ref.id, stored && mockPick(stored, options.fieldMask))]
        },
        collection: (name: string) => ({
          doc: (id: string) => ({
            path: `${name}/${id}`,
            id,
            get: async () => mockSnapshot(id, mockDocs.get(`${name}/${id}`)),
            collection: (sub: string) => ({
              // `{orgs|hosts}/{id}/installs`, projected to `version`
              select: () => ({
                get: async () => ({
                  docs: (mockInstalls.get(`${name}/${id}`) ?? []).map((listingId) =>
                    mockSnapshot(listingId, { version: '1.0.0' }),
                  ),
                }),
              }),
              // `marketplaceListings/{id}/pluginVersions/{version}`
              doc: (version: string) => ({
                get: async () =>
                  mockSnapshot(
                    version,
                    sub === 'pluginVersions'
                      ? {
                          sha256: 'a'.repeat(64),
                          signature: 'sig',
                          trust: 'realm',
                          manifest: { hostAbi: 2 },
                        }
                      : undefined,
                  ),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

jest.mock('./organizations', () => ({
  resolveOrgIdForHost: async (hostId: string) =>
    (mockDocs.get(`hostIndex/${hostId}`)?.['orgId'] as string | undefined) ?? null,
}))

jest.mock('../render-cache', () => {
  const actual = jest.requireActual('../render-cache')
  return {
    ...actual,
    withRenderCache: async (options: {
      key: string[]
      tags: string[]
      read: () => Promise<unknown>
    }) => {
      mockCacheCalls.push({ key: [...options.key], tags: [...options.tags] })
      return options.read()
    },
  }
})

import { tenantDataTag } from '../render-cache'
import { getRealmPluginInstalls } from './realm-plugins'

const ORG = 'org-1'
const SITE = 'site-a'
const OTHER = 'site-b'

const listingIds = (installs: ReadonlyArray<{ listingId: string }>) =>
  installs.map((install) => install.listingId)

beforeEach(() => {
  mockDocs.clear()
  mockInstalls.clear()
  mockMasks.length = 0
  mockCacheCalls.length = 0
  mockHostReadFails = false
  mockDocs.set(`orgs/${ORG}`, { enabledPlugins: ['commerce', 'listing1', 'listing2'] })
  mockDocs.set(`hostIndex/${SITE}`, { orgId: ORG })
  mockDocs.set(`hostIndex/${OTHER}`, { orgId: ORG })
  mockInstalls.set(`orgs/${ORG}`, ['listing1', 'listing2'])
})

describe("a site's own switch stops a marketplace plugin there (AGL-4047)", () => {
  it('runs every workspace pin on a site that switched nothing off (the control)', async () => {
    mockDocs.set(`hosts/${SITE}`, { orgId: ORG, theme: { big: true } })
    const installs = await getRealmPluginInstalls({ hostId: SITE })
    expect(listingIds(installs)).toEqual(['listing1', 'listing2'])
  })

  it('drops the listing the site switched off, and only that one', async () => {
    mockDocs.set(`hosts/${SITE}`, { disabledPlugins: ['listing1'] })
    const installs = await getRealmPluginInstalls({ hostId: SITE })
    expect(listingIds(installs)).toEqual(['listing2'])
  })

  it('leaves the other sites of the workspace alone', async () => {
    mockDocs.set(`hosts/${SITE}`, { disabledPlugins: ['listing1'] })
    mockDocs.set(`hosts/${OTHER}`, {})
    const installs = await getRealmPluginInstalls({ hostId: OTHER })
    expect(listingIds(installs)).toEqual(['listing1', 'listing2'])
  })

  it("drops the site's own pin of that listing too", async () => {
    mockInstalls.set(`orgs/${ORG}`, [])
    mockInstalls.set(`hosts/${SITE}`, ['listing1'])
    mockDocs.set(`hosts/${SITE}`, { disabledPlugins: ['listing1'] })
    await expect(getRealmPluginInstalls({ hostId: SITE })).resolves.toEqual([])
  })

  it('answers the same when the console names the workspace and the site', async () => {
    // `/api/orgs/realm-plugins?hostId=`, which the Besigner offers elements from.
    mockDocs.set(`hosts/${SITE}`, { disabledPlugins: ['listing2'] })
    const installs = await getRealmPluginInstalls({ orgId: ORG, hostId: SITE })
    expect(listingIds(installs)).toEqual(['listing1'])
  })

  it('ignores the built-in ids that share the list', async () => {
    mockDocs.set(`hosts/${SITE}`, { disabledPlugins: ['commerce', 'bookings'] })
    const installs = await getRealmPluginInstalls({ hostId: SITE })
    expect(listingIds(installs)).toEqual(['listing1', 'listing2'])
  })

  it('cannot switch on what the workspace switched off', async () => {
    mockDocs.set(`orgs/${ORG}`, { enabledPlugins: ['listing2'] })
    mockDocs.set(`hosts/${SITE}`, { disabledPlugins: [], enabledPlugins: ['listing1'] })
    const installs = await getRealmPluginInstalls({ hostId: SITE })
    expect(listingIds(installs)).toEqual(['listing2'])
  })

  it('reads the site masked to its deny-list, and only when a site is named', async () => {
    mockDocs.set(`hosts/${SITE}`, { disabledPlugins: ['listing1'], seo: { x: 1 } })
    await getRealmPluginInstalls({ hostId: SITE })
    expect(mockMasks).toEqual(
      expect.arrayContaining([{ path: `hosts/${SITE}`, fieldMask: ['disabledPlugins'] }]),
    )
    expect(mockMasks.filter((m) => m.path.startsWith('hosts/'))).toHaveLength(1)

    mockMasks.length = 0
    await getRealmPluginInstalls({ orgId: ORG })
    expect(mockMasks.filter((m) => m.path.startsWith('hosts/'))).toEqual([])
  })

  it('loads nothing when the site cannot be read, never what it switched off', async () => {
    mockHostReadFails = true
    await expect(getRealmPluginInstalls({ orgId: ORG, hostId: SITE })).rejects.toThrow(
      'unavailable',
    )
  })

  it('is cached under the tag a site settings save drops, so a switch-off reaches the page', async () => {
    // The switch writes `disabledPlugins`, a rendered host field, so the
    // console drops the whole site: `tenant-data:{hostId}` among it
    // (`renderedHostFieldsIn`, `host-document-writes.ts`). The cached join has
    // to carry that tag, or the page would regenerate from a join that still
    // lists the plugin.
    mockDocs.set(`hosts/${SITE}`, {})
    await getRealmPluginInstalls({ hostId: SITE })
    expect(mockCacheCalls).toHaveLength(1)
    expect(mockCacheCalls[0].key).toEqual(['tenant-realm-plugins', SITE])
    expect(mockCacheCalls[0].tags).toContain(tenantDataTag(SITE))
  })
})
