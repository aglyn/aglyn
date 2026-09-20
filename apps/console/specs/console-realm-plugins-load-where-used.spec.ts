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
 * A realm install's console code loads only where the screen draws one of its
 * declared contributions (AGL-3142).
 *
 * This is where the bytes are. The console's realm host hands a remote bundle
 * the whole core namespace and measures 237.4 KB on the wire in a production
 * build; it used to be composed on the workspace shell for any organization
 * with an install at all, so a workspace that installed a plugin for one panel
 * paid for the host — and ran the bundle's `register()` — on the billing page,
 * the besigner and every other screen.
 *
 * `composeRealmPluginHost` stands in for the host chunk itself: the
 * `await import()` that fetches it is the line directly above the call, inside
 * the same branch, so a run that never composes is a run that never fetched.
 */

const MOCK_ORG_ID = 'org-1'
/** The account the realm fetch authorizes as — all it needs is a token. */
const MOCK_USER = { getIdToken: async () => 'id-token' }

/** Installs the realm-plugins endpoint answers with. */
let mockInstalls: Array<Record<string, unknown>>
/** How many times the endpoint was asked. */
let mockFetches: number
/** Each `loadRealmPlugins` call, as the listing ids it was handed. */
let mockLoaded: string[][]
/** Each time the host ABI was composed for a bundle to run against. */
let mockComposed: number

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async () => {
    mockFetches += 1
    return {
      ok: true,
      json: async () => ({ installs: mockInstalls }),
    }
  },
}))
jest.mock('@aglyn/aglyn/plugin-manager/realm-plugins', () => ({
  loadRealmPlugins: async (installs: Array<{ listingId: string }>) => {
    mockLoaded.push(installs.map((install) => install.listingId))
  },
}))
jest.mock('@aglyn/aglyn/plugin-manager/plugin-styles', () => ({
  capturePluginStyles: async (_id: string, run: () => Promise<void>) => run(),
}))
jest.mock('../utils/realm-plugin-host.client', () => ({
  composeRealmPluginHost: () => {
    mockComposed += 1
  },
}))

import {
  loadOrgRealmPlugins,
  resetOrgRealmInstallsForTests,
} from '../utils/realm-plugins.client'

/** Fills one console zone and draws nothing on the shell. */
const ZONE_INSTALL = {
  listingId: 'promo-countdown',
  version: '1.0.0',
  sha256: 'a'.repeat(64),
  trust: 'realm',
  contributes: { console: { slots: ['hostDashboard'] } },
}
/** Published before the contract: no declaration at all. */
const UNDECLARED_INSTALL = {
  listingId: 'office-hours',
  version: '2.1.0',
  sha256: 'b'.repeat(64),
  trust: 'realm',
}

const load = (where: Parameters<typeof loadOrgRealmPlugins>[2]) =>
  loadOrgRealmPlugins(MOCK_ORG_ID, MOCK_USER, where)

beforeEach(() => {
  mockInstalls = []
  mockFetches = 0
  mockLoaded = []
  mockComposed = 0
  resetOrgRealmInstallsForTests()
  process.env['NEXT_PUBLIC_PLUGIN_ORIGIN'] = 'https://artifacts.example'
})

afterEach(() => {
  delete process.env['NEXT_PUBLIC_PLUGIN_ORIGIN']
})

describe('a realm install loads where the console draws it (AGL-3142)', () => {
  it('composes nothing on the shell for an install that only fills a zone', async () => {
    mockInstalls = [ZONE_INSTALL]

    await load({ at: 'shell' })

    expect(mockLoaded).toEqual([])
    // The host chunk is the cost, and it was never reached.
    expect(mockComposed).toBe(0)
  })

  it('loads that same install where its zone is rendered', async () => {
    mockInstalls = [ZONE_INSTALL]

    await load({ at: 'slots', slots: ['hostDashboard'] })

    expect(mockLoaded).toEqual([['promo-countdown']])
    expect(mockComposed).toBe(1)
  })

  it('does not load it at a zone it does not declare', async () => {
    mockInstalls = [ZONE_INSTALL]

    await load({ at: 'slots', slots: ['orgSettings'] })

    expect(mockLoaded).toEqual([])
    expect(mockComposed).toBe(0)
  })

  it('keeps loading an install that declares nothing with the shell', async () => {
    // The compatibility default every version published before the contract
    // relies on: its console contribution is discoverable only by running
    // `register()`, so narrowing it would take a widget away silently.
    mockInstalls = [UNDECLARED_INSTALL]

    await load({ at: 'shell' })

    expect(mockLoaded).toEqual([['office-hours']])
  })

  it('hands each place only the installs that belong to it', async () => {
    mockInstalls = [ZONE_INSTALL, UNDECLARED_INSTALL]

    await load({ at: 'shell' })
    await load({ at: 'slots', slots: ['hostDashboard'] })

    expect(mockLoaded).toEqual([['office-hours'], ['promo-countdown']])
  })

  it('asks the endpoint once for a workspace, however many places load', async () => {
    mockInstalls = [ZONE_INSTALL]

    await load({ at: 'shell' })
    await load({ at: 'route', href: '/promos', level: 'site' })
    await load({ at: 'slots', slots: ['hostDashboard'] })

    // Every zone on every screen asks; one request answers all of them.
    expect(mockFetches).toBe(1)
  })

  it('composes nothing at all for a workspace with no installs', async () => {
    mockInstalls = []

    await load({ at: 'shell' })

    expect(mockComposed).toBe(0)
    expect(mockLoaded).toEqual([])
  })
})
