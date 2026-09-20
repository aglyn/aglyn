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

import { realmPluginsInUse, requiredSitePlugins } from './required-site-plugins'

const ENABLED = ['mui', 'bookings', 'commerce', 'marketing', 'events-calendar']

const muiNodes = {
  _root_: { pluginId: undefined as string | undefined },
  a: { pluginId: 'mui' },
  b: { pluginId: 'mui' },
}

describe('requiredSitePlugins', () => {
  it('narrows to the plugins the document uses when nothing contributed', () => {
    expect(
      requiredSitePlugins({ nodes: muiNodes, enabledPlugins: ENABLED }),
    ).toEqual(['mui'])
  })

  it('keeps a plugin whose components are on the page', () => {
    expect(
      requiredSitePlugins({
        nodes: { ...muiNodes, c: { pluginId: 'commerce' } },
        enabledPlugins: ENABLED,
      }),
    ).toEqual(['mui', 'commerce'])
  })

  it('keeps a plugin that contributed, even with no components on the page', () => {
    // This is /pricing: marketing has no nodes here but its clientAutomations
    // are live, so it must still register before the page renders.
    expect(
      requiredSitePlugins({
        nodes: muiNodes,
        contributors: ['marketing'],
        enabledPlugins: ENABLED,
      }),
    ).toEqual(['mui', 'marketing'])
  })

  it('returns the enabled list order, not node or contributor order', () => {
    expect(
      requiredSitePlugins({
        nodes: { z: { pluginId: 'events-calendar' }, a: { pluginId: 'mui' } },
        contributors: ['marketing'],
        enabledPlugins: ENABLED,
      }),
    ).toEqual(['mui', 'marketing', 'events-calendar'])
  })

  it('never returns a plugin the org has not enabled', () => {
    expect(
      requiredSitePlugins({
        nodes: { a: { pluginId: 'mui' }, b: { pluginId: 'inbox' } },
        contributors: ['not-enabled-either'],
        enabledPlugins: ENABLED,
      }),
    ).toEqual(['mui'])
  })

  it('always includes mui even when no node names it', () => {
    expect(
      requiredSitePlugins({
        nodes: { a: { pluginId: undefined } },
        enabledPlugins: ENABLED,
      }),
    ).toEqual(['mui'])
  })

  // --- the refusals: each is a case where narrowing could break or flash ---

  it('refuses when a contribution could not be attributed', () => {
    expect(
      requiredSitePlugins({
        nodes: muiNodes,
        unattributed: true,
        enabledPlugins: ENABLED,
      }),
    ).toBeNull()
  })

  it('refuses when there are no nodes to inspect', () => {
    expect(
      requiredSitePlugins({ nodes: null, enabledPlugins: ENABLED }),
    ).toBeNull()
  })

  it('refuses when the enabled list is missing or empty', () => {
    expect(requiredSitePlugins({ nodes: muiNodes })).toBeNull()
    expect(
      requiredSitePlugins({ nodes: muiNodes, enabledPlugins: [] }),
    ).toBeNull()
  })

  it('refuses when nothing would be dropped', () => {
    expect(
      requiredSitePlugins({ nodes: muiNodes, enabledPlugins: ['mui'] }),
    ).toBeNull()
    expect(
      requiredSitePlugins({
        nodes: { ...muiNodes, c: { pluginId: 'commerce' } },
        contributors: ['bookings', 'marketing', 'events-calendar'],
        enabledPlugins: ENABLED,
      }),
    ).toBeNull()
  })

  it('does not mutate or reorder the enabled list', () => {
    const enabled = [...ENABLED]
    requiredSitePlugins({ nodes: muiNodes, enabledPlugins: enabled })
    expect(enabled).toEqual(ENABLED)
  })
})

describe('realmPluginsInUse (AGL-3116)', () => {
  const install = (overrides: Record<string, unknown> = {}) => ({
    listingId: 'Tfnrb4wJzF',
    version: '1.0.0',
    sha256: 'a'.repeat(64),
    trust: 'realm',
    signature: 'sig',
    pluginId: 'promo-countdown',
    ...overrides,
  })
  const page = {
    _root_: { componentId: 'div', pluginId: 'mui' },
    a: { componentId: 'muiTypography', pluginId: 'mui' },
  }

  it('drops an install whose only contribution is a console widget', () => {
    // aglyn.com's case: pinned org-wide for a hostActivity widget, placed on
    // no page — the realm host must not load for it.
    expect(
      realmPluginsInUse(
        [install({ contributes: { console: { slots: ['hostActivity'] } } })],
        page,
      ),
    ).toEqual([])
  })

  it('drops an UNDECLARED install when no node is stamped with its id', () => {
    expect(realmPluginsInUse([install()], page)).toEqual([])
  })

  it('keeps an undeclared install where a node carries its id', () => {
    const placed = { ...page, b: { componentId: 'promoBanner', pluginId: 'promo-countdown' } }
    expect(realmPluginsInUse([install()], placed)).toHaveLength(1)
    // A node stamped with the listing id counts the same.
    const byListing = { ...page, b: { componentId: 'promoBanner', pluginId: 'Tfnrb4wJzF' } }
    expect(realmPluginsInUse([install()], byListing)).toHaveLength(1)
  })

  it('keeps a declared install where the page places one of its components', () => {
    const declared = install({ contributes: { site: { components: ['promoBanner'] } } })
    expect(realmPluginsInUse([declared], page)).toEqual([])
    expect(
      realmPluginsInUse([declared], { ...page, b: { componentId: 'promoBanner' } }),
    ).toEqual([declared])
  })

  it('keeps an install with a site feature on every page', () => {
    const feature = install({ contributes: { site: { features: ['promo-bar'] } } })
    expect(realmPluginsInUse([feature], page)).toEqual([feature])
  })

  it('loads nothing for a page with no nodes', () => {
    expect(realmPluginsInUse([install()], null)).toEqual([])
  })
})
