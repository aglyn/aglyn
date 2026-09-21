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
 * A plugin's page says what it is, and a failure to say it costs nothing
 * (AGL-3080).
 *
 * Three things this contract has to get right, each of which fails quietly:
 * a route belongs to one plugin, an address nobody describes keeps the
 * shell's own title, and a declaration that throws on the render path must
 * not take the page down with it.
 */

import {
  listPluginRouteMetadata,
  pluginRouteMetadata,
  registerPluginRouteMetadata,
  resolvePluginRouteHead,
} from './plugin-route-metadata'
import { resetPluginServicesForTests } from './plugin-services'

beforeEach(() => {
  resetPluginServicesForTests()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a plugin declaring how its route answers', () => {
  it('answers for the address it understands', async () => {
    registerPluginRouteMetadata(
      {
        route: 'marketplace',
        resolve: async (segments) =>
          segments.length === 1
            ? { title: `Listing ${segments[0]}`, description: 'A listing' }
            : null,
      },
      { pluginId: 'marketplace' },
    )

    expect(await resolvePluginRouteHead('marketplace', ['listing-1'])).toEqual({
      title: 'Listing listing-1',
      description: 'A listing',
    })
  })

  it('keeps the shell’s own title for an address it has nothing to add about', async () => {
    registerPluginRouteMetadata(
      { route: 'marketplace', resolve: async () => null },
      { pluginId: 'marketplace' },
    )
    // The hub, a tab, a record it must not describe: `null` and "no plugin
    // declared this route" are deliberately the same answer, because a head
    // is an enrichment of a page that renders without one.
    expect(await resolvePluginRouteHead('marketplace', [])).toBeNull()
    expect(await resolvePluginRouteHead('crm', ['contact-1'])).toBeNull()
  })

  it('takes the route with or without its leading slash', async () => {
    registerPluginRouteMetadata(
      { route: '/marketplace', resolve: async () => ({ title: 'Listing' }) },
      { pluginId: 'marketplace' },
    )
    expect(pluginRouteMetadata('marketplace')?.pluginId).toBe('marketplace')
    expect(await resolvePluginRouteHead('/marketplace', ['x'])).toEqual({
      title: 'Listing',
    })
  })

  it('costs the page nothing when a resolver throws', async () => {
    registerPluginRouteMetadata(
      {
        route: 'marketplace',
        resolve: async () => {
          throw new Error('firestore is unhappy')
        },
      },
      { pluginId: 'marketplace' },
    )

    // Returned as "nothing to add", never rethrown: this runs inside a
    // layout's metadata, where a rejection fails the whole route.
    await expect(
      resolvePluginRouteHead('marketplace', ['listing-1']),
    ).resolves.toBeNull()
    expect(console.error).toHaveBeenCalled()
  })

  it('refuses a second plugin’s claim on the same route, naming both', () => {
    registerPluginRouteMetadata(
      { route: 'marketplace', resolve: async () => ({ title: 'Listing' }) },
      { pluginId: 'marketplace' },
    )
    expect(() =>
      registerPluginRouteMetadata(
        { route: 'marketplace', resolve: async () => ({ title: 'Mine' }) },
        { pluginId: 'impostor' },
      ),
    ).toThrow(/already declared by "marketplace".*refused "impostor"/)
  })

  it('lets the owner replace its own declaration', async () => {
    registerPluginRouteMetadata(
      { route: 'marketplace', resolve: async () => ({ title: 'First' }) },
      { pluginId: 'marketplace' },
    )
    registerPluginRouteMetadata(
      { route: 'marketplace', resolve: async () => ({ title: 'Second' }) },
      { pluginId: 'marketplace' },
    )
    expect(listPluginRouteMetadata()).toHaveLength(1)
    expect(await resolvePluginRouteHead('marketplace', ['x'])).toEqual({
      title: 'Second',
    })
  })

  it('refuses a declaration that names no route or cannot answer', () => {
    expect(() =>
      registerPluginRouteMetadata(
        { route: '  ', resolve: async () => null },
        { pluginId: 'marketplace' },
      ),
    ).toThrow('needs a route')
    expect(() =>
      registerPluginRouteMetadata(
        { route: 'marketplace', resolve: undefined as never },
        { pluginId: 'marketplace' },
      ),
    ).toThrow('needs a resolve function')
  })
})
