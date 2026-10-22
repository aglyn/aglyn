/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves
 * the suite on jsdom.
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
 * THIS APP INSTALLS THE SITE-CACHE CAPABILITY AT BOOT (AGL-3080).
 *
 * A marketplace revocation drops the cached pages of every site running the
 * plugin. The plugin finds the sites; dropping them is this app's, because
 * it takes the tenant's revalidation paths and cache tags.
 *
 * ⛔ WHICH MAKES THE BOOT WIRING THE WHOLE RISK. The capability lives in a
 * runtime registry, and a process that never filled it resolves "no cache to
 * drop" — indistinguishable, from the inside, from a workspace whose sites
 * were already fresh. That is the AGL-3025 shape, and on this path it means
 * a revoked plugin goes on executing in visitors' browsers for as long as
 * the cache holds. The contract answers `complete: false` rather than a bare
 * zero precisely so the absence is visible; this spec is what makes the
 * absence RED.
 *
 * So it registers nothing itself. It drives the real `register()` and then
 * calls what a plugin calls, and the fan-out being reached is the whole
 * assertion.
 *
 * The contract's own behaviour — the empty request, the throw, the refusal
 * of a second implementation — is held next to it, in
 * `libs/aglyn/src/lib/plugin-manager/plugin-site-cache.spec.ts`.
 */

export {}

/** Host ids the fan-out was asked to drop, per call. */
const mockDropped: string[][] = []
/** What the fan-out answers: `hosts` dropped and `hostsDropped` capped. */
let mockFanout = { hosts: 0, hostsDropped: 0 }

jest.mock('../constants/plugins.declarations.server.generated', () => ({
  __esModule: true,
  registerPluginServerDeclarations: async () => undefined,
}))

jest.mock('../utils/server/tenant-revalidate', () => ({
  __esModule: true,
  dropSiteCaches: async (
    _firestore: unknown,
    options: { hostIds: readonly string[] },
  ) => {
    mockDropped.push([...options.hostIds])
    return {
      hosts: Array.from({ length: mockFanout.hosts }, () => ({})),
      hostsDropped: mockFanout.hostsDropped,
    }
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => ({}) }) },
}))

import {
  dropPluginSiteCache,
  hasPluginSiteCache,
} from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { register } from '../instrumentation'

const NODE_RUNTIME = process.env.NEXT_RUNTIME

beforeEach(() => {
  process.env.NEXT_RUNTIME = 'nodejs'
  resetPluginServicesForTests()
  mockDropped.length = 0
  mockFanout = { hosts: 0, hostsDropped: 0 }
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
  if (NODE_RUNTIME === undefined) delete process.env.NEXT_RUNTIME
  else process.env.NEXT_RUNTIME = NODE_RUNTIME
})

describe('the site-cache capability is installed by this app', () => {
  it('CONTROL: nothing answers before the boot step runs', async () => {
    // Without this the assertions below would pass against a registry some
    // other suite had filled, which is the one way this guard could be
    // green and mean nothing.
    expect(hasPluginSiteCache()).toBe(false)
    const early = await dropPluginSiteCache({
      hostIds: ['host-1'],
      reason: 'before boot',
    })
    expect(early.complete).toBe(false)
  })

  it('and the drop reaches the fan-out once it has', async () => {
    await register()
    expect(hasPluginSiteCache()).toBe(true)

    mockFanout = { hosts: 2, hostsDropped: 0 }
    const result = await dropPluginSiteCache({
      hostIds: ['host-1', 'host-2'],
      reason: 'marketplace listing lst_1 revoked',
    })

    expect(mockDropped).toEqual([['host-1', 'host-2']])
    expect(result).toEqual({ dropped: 2, skipped: 0, complete: true })
  })

  it('carries a capped fan-out back as skipped, not as success', async () => {
    await register()
    mockFanout = { hosts: 200, hostsDropped: 43 }
    const result = await dropPluginSiteCache({
      hostIds: ['host-1'],
      reason: 'a very wide revoke',
    })
    // Those 43 sites are still serving what was just stopped. The caller
    // gets the number rather than a boolean, because it is the thing a
    // reviewer would want said on the page.
    expect(result).toEqual({ dropped: 200, skipped: 43, complete: true })
  })
})
