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

import { requiredSitePlugins } from './required-site-plugins'

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
