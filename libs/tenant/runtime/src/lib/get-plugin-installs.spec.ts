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
 * The SANDBOX execution path on published tenant sites (AGL-45), and what
 * stops it (AGL-948/952).
 *
 * `getPluginInstalls` resolves what a host's `marketplacePlugin` nodes render.
 * It consults `revocations/{listingId}` and nothing else — NOT the listing's
 * `hiddenAt` — which is precisely why staff takedown had to write a
 * revocation rather than only flip a flag: a takedown that only set
 * `hiddenAt` would have stopped realm plugins while leaving sandboxed ones
 * executing on every tenant site that had them placed.
 *
 * These are the paths a takedown has to reach: org-tier installs (every host
 * in the workspace), host-tier installs, and the merge between them.
 */

const orgInstalls = new Map<string, Record<string, unknown>>()
const hostInstalls = new Map<string, Record<string, unknown>>()
const revocations = new Map<string, Record<string, unknown>>()

const docSnapshot = (id: string, data: Record<string, unknown>) => ({
  id,
  data: () => data,
  get: (field: string) =>
    field
      .split('.')
      .reduce<unknown>(
        (value, key) => (value as Record<string, unknown>)?.[key],
        data,
      ),
})

const collectionOf = (store: Map<string, Record<string, unknown>>) => ({
  limit: () => ({
    get: async () => ({
      docs: [...store.entries()].map(([id, data]) => docSnapshot(id, data)),
    }),
  }),
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  resolveOrgIdForHost: async () => 'org-1',
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => ({
            get: async () => docSnapshot(id, revocations.get(id) ?? {}),
            data: () => revocations.get(id),
            collection: () =>
              collectionOf(name === 'orgs' ? orgInstalls : hostInstalls),
          }),
        }),
      }),
    }),
  },
}))

// The revocation predicate under test is the real one from @aglyn/aglyn.
jest.mock('@aglyn/aglyn/server', () => {
  const actual = jest.requireActual('@aglyn/aglyn/server')
  return { ...actual }
})

import { getPluginInstalls } from './get-plugin-installs'

const LISTING = 'listing-1'
const pin = (version: string) => ({
  version,
  sha256: 'a'.repeat(64),
  manifest: { capabilities: { network: [] } },
})

beforeEach(() => {
  orgInstalls.clear()
  hostInstalls.clear()
  revocations.clear()
})

describe('getPluginInstalls — what a takedown has to reach', () => {
  it('renders an org-tier install with no revocation', async () => {
    orgInstalls.set(LISTING, pin('1.0.0'))
    const installs = await getPluginInstalls({ hostId: 'host-1' })
    expect(installs[LISTING]).toMatchObject({ version: '1.0.0', revoked: false })
  })

  it('marks an org-tier install revoked — every host in the workspace', async () => {
    // What a staff takedown writes: versions 'all', source 'takedown'.
    orgInstalls.set(LISTING, pin('1.0.0'))
    revocations.set(LISTING, { versions: 'all', source: 'takedown' })
    const installs = await getPluginInstalls({ hostId: 'host-1' })
    expect(installs[LISTING].revoked).toBe(true)
  })

  it('marks a host-tier install revoked', async () => {
    hostInstalls.set(LISTING, pin('2.0.0'))
    revocations.set(LISTING, { versions: 'all', source: 'takedown' })
    const installs = await getPluginInstalls({ hostId: 'host-1' })
    expect(installs[LISTING].revoked).toBe(true)
  })

  it('revokes the merged pin when a host pin overrides an org pin', async () => {
    // Host wins on version; the kill switch must still apply to the winner.
    orgInstalls.set(LISTING, pin('1.0.0'))
    hostInstalls.set(LISTING, pin('2.0.0'))
    revocations.set(LISTING, { versions: 'all', source: 'takedown' })
    const installs = await getPluginInstalls({ hostId: 'host-1' })
    expect(installs[LISTING]).toMatchObject({ version: '2.0.0', revoked: true })
  })

  it('honours a version-scoped revocation without touching other versions', async () => {
    orgInstalls.set(LISTING, pin('1.0.0'))
    revocations.set(LISTING, { versions: ['9.9.9'] })
    const installs = await getPluginInstalls({ hostId: 'host-1' })
    expect(installs[LISTING].revoked).toBe(false)
  })

  it('skips a pin with no version or sha — nothing to execute', async () => {
    orgInstalls.set(LISTING, { version: '', sha256: '' })
    const installs = await getPluginInstalls({ hostId: 'host-1' })
    expect(installs[LISTING]).toBeUndefined()
  })
})
