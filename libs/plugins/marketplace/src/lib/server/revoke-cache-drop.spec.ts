/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock.
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
 * WHICH SITES A REVOCATION HAS TO REACH (AGL-1152, moved here by AGL-3080).
 *
 * This half was `revalidateHostsWithPlugin` in the console's
 * `tenant-revalidate.ts`, which meant the console knew what an install pin
 * is. `installs` is this plugin's own collection, so the walk came here and
 * the fan-out stayed there, reached through `dropPluginSiteCache`.
 *
 * What has to hold is unchanged, and the org-tier case is the one that bites:
 * a pin at `orgs/{orgId}/installs` applies to every host in the org, and it
 * is those hosts that hold the cached HTML — the org renders nothing. A walk
 * that only understood host installs would leave every org-tier site running
 * the bundle that was just killed.
 */

import { dropCachesForListing } from './revoke-cache-drop'
import {
  registerPluginSiteCache,
  type PluginSiteCacheRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'

/** Every request the shell's cache was handed. */
const asked: PluginSiteCacheRequest[] = []

/** Minimal Firestore double: only the shapes this walk touches. */
function makeFirestore(options: {
  hosts?: Record<string, { orgId?: string }>
  installs?: Array<{ owner: 'hosts' | 'orgs'; ownerId: string }>
  throws?: boolean
}) {
  const hosts = options.hosts ?? {}
  const installs = options.installs ?? []
  return {
    collection(name: string) {
      if (name !== 'hosts') throw new Error(`unexpected collection ${name}`)
      return {
        where: (_field: string, _op: string, value: string) => ({
          get: async () => ({
            docs: Object.entries(hosts)
              .filter(([, host]) => host.orgId === value)
              .map(([id]) => ({ id })),
          }),
        }),
      }
    },
    collectionGroup(name: string) {
      if (name !== 'installs') throw new Error(`unexpected group ${name}`)
      return {
        where: () => ({
          get: async () => {
            if (options.throws) throw new Error('index missing')
            return {
              empty: installs.length === 0,
              size: installs.length,
              docs: installs.map((install) => ({
                ref: {
                  parent: {
                    parent: { id: install.ownerId, parent: { id: install.owner } },
                  },
                },
              })),
            }
          },
        }),
      }
    },
  } as never
}

beforeEach(() => {
  resetPluginServicesForTests()
  asked.length = 0
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  registerPluginSiteCache(
    {
      drop: async (request) => {
        asked.push(request)
        return { dropped: request.hostIds.length, skipped: 0, complete: true }
      },
    },
    { pluginId: 'console' },
  )
})

afterEach(() => jest.restoreAllMocks())

describe('a revocation reaches host-scoped AND org-scoped installs', () => {
  it('expands an org-tier pin to every host in the org', async () => {
    const result = await dropCachesForListing(
      makeFirestore({
        hosts: {
          direct: {},
          orgA1: { orgId: 'orgA' },
          orgA2: { orgId: 'orgA' },
          unrelated: { orgId: 'orgB' },
        },
        installs: [
          { owner: 'hosts', ownerId: 'direct' },
          { owner: 'orgs', ownerId: 'orgA' },
        ],
      }),
      'listing-1',
    )

    expect(asked[0].hostIds).toEqual(['direct', 'orgA1', 'orgA2'])
    // The other org's site is running something else and must not be purged.
    expect(asked[0].hostIds).not.toContain('unrelated')
    expect(result.installsFound).toBe(2)
    expect(result.complete).toBe(true)
  })

  it('names the listing in the reason, so a truncated purge is debuggable', async () => {
    await dropCachesForListing(
      makeFirestore({ hosts: { h: {} }, installs: [{ owner: 'hosts', ownerId: 'h' }] }),
      'lst_abc',
    )
    expect(asked[0].reason).toContain('lst_abc')
  })

  it('asks for nothing when no site runs it', async () => {
    const result = await dropCachesForListing(
      makeFirestore({ hosts: {}, installs: [] }),
      'listing-1',
    )
    expect(asked).toHaveLength(0)
    expect(result).toEqual({
      installsFound: 0,
      dropped: 0,
      skipped: 0,
      complete: true,
    })
  })

  it('and for nothing at all without a listing id', async () => {
    const result = await dropCachesForListing(makeFirestore({}), '')
    expect(asked).toHaveLength(0)
    expect(result.complete).toBe(true)
  })

  it('⛔ a failed READ is complete:false, not "no sites affected"', async () => {
    // The zero that reads as an answer. If the install query fails, nothing
    // is known about which sites are running the revoked bundle — which is
    // not the same as none, and a caller must be able to tell them apart.
    const result = await dropCachesForListing(
      makeFirestore({ throws: true }),
      'listing-1',
    )
    expect(result).toEqual({
      installsFound: 0,
      dropped: 0,
      skipped: 0,
      complete: false,
    })
    expect(asked).toHaveLength(0)
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('could not find the sites running'),
      'listing-1',
      expect.any(Error),
    )
  })

  it('carries the shell’s truncation back to the caller', async () => {
    resetPluginServicesForTests()
    registerPluginSiteCache(
      { drop: async () => ({ dropped: 200, skipped: 12, complete: true }) },
      { pluginId: 'console' },
    )
    const result = await dropCachesForListing(
      makeFirestore({ hosts: { h: {} }, installs: [{ owner: 'hosts', ownerId: 'h' }] }),
      'listing-1',
    )
    // Twelve sites are still serving the killed bundle. The number survives
    // the trip so a reviewer can be told.
    expect(result.skipped).toBe(12)
  })
})
