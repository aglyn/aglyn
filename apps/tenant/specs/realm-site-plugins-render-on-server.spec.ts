/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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
 * A published page's signed marketplace plugins load on the server as well as
 * in the browser (AGL-3390).
 *
 * The server cannot import a blob URL, so it loads through a `data:` URL, and
 * it gives up on a slow artifacts origin rather than hold the page. Every
 * caller asking for the same install list shares one load: the page suspends
 * on it, each namespaced element waits on it, and the post-hydration effect
 * reuses it.
 */

let mockLoads: Array<{ installs: string[]; options: Record<string, unknown> }>

jest.mock('../utils/realm-plugin-host.client', () => ({
  composeRealmPluginHost: () => undefined,
  loadRealmPlugins: async (
    installs: Array<{ listingId: string }>,
    options: Record<string, unknown>,
  ) => {
    mockLoads.push({ installs: installs.map((install) => install.listingId), options })
  },
  realmRegistry: { name: 'registry' },
}))

import {
  devRealmPluginIds,
  loadSiteRealmPlugins,
  rendersOnServer,
  resetSiteRealmLoadsForTests,
} from '../utils/realm-plugins.client'

const CALCULATOR = {
  listingId: 'listing-calc',
  version: '1.0.0',
  sha256: 'a'.repeat(64),
  trust: 'realm',
  identity: 'aglyn.calculator',
  contributes: { site: { components: ['aglyn.calculator.scope'] } },
}

beforeEach(() => {
  mockLoads = []
  resetSiteRealmLoadsForTests()
  process.env['NEXT_PUBLIC_PLUGIN_ORIGIN'] = 'https://artifacts.example'
  process.env['NEXT_PUBLIC_PLUGIN_TRUST_PUBLIC_KEY'] = 'key'
})

afterEach(() => {
  delete process.env['NEXT_PUBLIC_PLUGIN_ORIGIN']
  delete process.env['NEXT_PUBLIC_PLUGIN_TRUST_PUBLIC_KEY']
})

describe('which installs render on the server (AGL-3390)', () => {
  it('is one with an identity that declares site components', () => {
    expect(rendersOnServer(CALCULATOR)).toBe(true)
  })

  it('is never one published before identities, nor one with no site elements', () => {
    expect(rendersOnServer({ ...CALCULATOR, identity: undefined })).toBe(false)
    expect(
      rendersOnServer({ ...CALCULATOR, contributes: { site: { features: ['x'] } } }),
    ).toBe(false)
  })
})

describe('the server load', () => {
  it('imports through a data URL, gives up on a slow origin, and checks the registry', async () => {
    await loadSiteRealmPlugins([CALCULATOR], { server: true })

    const [load] = mockLoads
    expect(load.installs).toEqual(['listing-calc'])
    expect(typeof load.options['importModule']).toBe('function')
    expect(load.options['fetchTimeoutMs']).toBeGreaterThan(0)
    expect(load.options['registry']).toEqual({ name: 'registry' })
  })

  it('leaves the browser to its own importer', async () => {
    await loadSiteRealmPlugins([CALCULATOR])

    expect(mockLoads[0].options['importModule']).toBeUndefined()
    expect(mockLoads[0].options['registry']).toEqual({ name: 'registry' })
  })

  it('shares one load between every caller asking for the same list', async () => {
    const first = loadSiteRealmPlugins([CALCULATOR])
    const second = loadSiteRealmPlugins([CALCULATOR])

    expect(second).toBe(first)
    await first
    expect(mockLoads).toHaveLength(1)
  })
})

describe("the dev loop's plugins are on the rendered site's set (AGL-3394)", () => {
  const env = process.env as Record<string, string | undefined>
  afterEach(() => {
    delete env['NEXT_PUBLIC_PLUGIN_DEV']
    delete env['NEXT_PUBLIC_PLUGIN_DEV_BUNDLES']
  })

  it('names each dev bundle by the id it is configured under', () => {
    env['NEXT_PUBLIC_PLUGIN_DEV'] = 'enabled'
    env['NEXT_PUBLIC_PLUGIN_DEV_BUNDLES'] =
      'aglyn.calculator=http://localhost:5173/plugin.bundle.mjs, acme.quote=http://localhost:5174/b.mjs'
    expect(devRealmPluginIds()).toEqual(['aglyn.calculator', 'acme.quote'])
  })

  it('names none without the opt-in', () => {
    env['NEXT_PUBLIC_PLUGIN_DEV_BUNDLES'] = 'aglyn.calculator=http://localhost:5173/plugin.bundle.mjs'
    expect(devRealmPluginIds()).toEqual([])
  })
})

