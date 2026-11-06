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
 * The realm-install join reads only the fields it uses (AGL-4121).
 *
 * The org document is read for `enabledPlugins` alone and each install pin for
 * its `version` alone. The double returns ONLY the projected fields, the way
 * Firestore does, so these specs fail if the join starts relying on a field
 * the projection leaves out — and the switchboard filter still has to hold.
 */

const mockOrgs = new Map<string, Record<string, unknown>>()
const mockInstalls = new Map<string, Record<string, unknown>[]>()
const mockOrgMasks: string[][] = []
const mockInstallSelects: string[][] = []

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
          ref: { collectionName: string; id: string },
          options: { fieldMask: string[] },
        ) => {
          mockOrgMasks.push(options.fieldMask)
          const stored = mockOrgs.get(ref.id)
          return [mockSnapshot(ref.id, stored && mockPick(stored, options.fieldMask))]
        },
        collection: (name: string) => ({
          doc: (id: string) => ({
            collectionName: name,
            id,
            get: async () =>
              mockSnapshot(
                id,
                name === 'marketplaceListings' ? { displayName: id } : undefined,
              ),
            collection: (sub: string) => ({
              // `{scope}/{id}/installs`, projected
              select: (...fields: string[]) => ({
                get: async () => {
                  mockInstallSelects.push(fields)
                  const docs = (mockInstalls.get(`${name}/${id}`) ?? []).map((pin) =>
                    mockSnapshot(String(pin['listingId']), mockPick(pin, fields)),
                  )
                  return { docs }
                },
              }),
              // `marketplaceListings/{id}/pluginVersions/{version}`
              doc: (version: string) => ({
                get: async () =>
                  mockSnapshot(version, sub === 'pluginVersions'
                    ? {
                        sha256: 'a'.repeat(64),
                        signature: 'sig',
                        trust: 'realm',
                        manifest: { hostAbi: 2 },
                      }
                    : undefined),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

import { getRealmPluginInstalls } from './realm-plugins'

/** An install pin as `install-plugin.ts` writes it: the manifest copy included. */
const pin = (listingId: string) => ({
  listingId,
  version: '1.0.0',
  sha256: 'a'.repeat(64),
  manifest: { id: listingId, big: 'x'.repeat(2_000) },
  installedFrom: { listingId },
})

beforeEach(() => {
  mockOrgs.clear()
  mockInstalls.clear()
  mockOrgMasks.length = 0
  mockInstallSelects.length = 0
})

describe('realm installs read through projections (AGL-4121)', () => {
  it('masks the org to enabledPlugins and the pins to version, and still resolves', async () => {
    mockOrgs.set('org-1', { name: 'Acme', plan: 'pro', enabledPlugins: ['listing1'] })
    mockInstalls.set('orgs/org-1', [pin('listing1')])
    const installs = await getRealmPluginInstalls({ orgId: 'org-1' })
    expect(installs.map((install) => install.listingId)).toEqual(['listing1'])
    expect(installs[0]).toMatchObject({ version: '1.0.0', trust: 'realm' })
    expect(mockOrgMasks).toEqual([['enabledPlugins']])
    expect(mockInstallSelects).toEqual([['version']])
  })

  it('keeps the switchboard: a listing off the explicit list does not load', async () => {
    mockOrgs.set('org-1', { enabledPlugins: [] })
    mockInstalls.set('orgs/org-1', [pin('listing1')])
    await expect(getRealmPluginInstalls({ orgId: 'org-1' })).resolves.toEqual([])
  })

  it('keeps default-open when the org has no list at all', async () => {
    mockOrgs.set('org-1', { name: 'Acme' })
    mockInstalls.set('orgs/org-1', [pin('listing1')])
    const installs = await getRealmPluginInstalls({ orgId: 'org-1' })
    expect(installs).toHaveLength(1)
  })
})
