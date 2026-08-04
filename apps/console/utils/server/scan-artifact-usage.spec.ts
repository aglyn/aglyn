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

import {
  countPluginNodes,
  scanComponentUsage,
  scanLayoutUsage,
  scanPluginPlacements,
  type UsageCandidate,
} from './scan-artifact-usage'

/** A node tree holding one instance of `refId`, as the besigner writes it. */
const treeWithInstance = (refId: string) => ({
  root: { $id: 'root', componentId: 'div', nodes: ['inst'] },
  inst: {
    $id: 'inst',
    componentId: 'reusableInstance',
    parentId: 'root',
    props: { refId },
    nodes: [],
  },
})
const emptyTree = { root: { $id: 'root', componentId: 'div', nodes: [] } }

describe('scanComponentUsage', () => {
  const screens: UsageCandidate[] = [
    {
      id: 'scr-home',
      displayName: 'Business Home',
      versionId: 'v1',
      nodes: treeWithInstance('cmp-footer'),
    },
    { id: 'scr-about', displayName: 'About Us', versionId: 'v2', nodes: emptyTree },
  ]
  const layouts: UsageCandidate[] = [
    {
      id: 'lay-main',
      displayName: 'Main Layout',
      versionId: 'v3',
      nodes: treeWithInstance('cmp-footer'),
    },
  ]
  const components: UsageCandidate[] = [
    { id: 'cmp-footer', displayName: 'Site Footer', nodes: emptyTree },
    {
      id: 'cmp-card',
      displayName: 'Product Card',
      nodes: treeWithInstance('cmp-badge'),
    },
    { id: 'cmp-badge', displayName: 'Sale Badge', nodes: emptyTree },
  ]

  it('reports a component placed on a screen, with its deep-link version', () => {
    const found = scanComponentUsage('cmp-footer', {
      screens,
      layouts,
      components,
    })
    expect(found).toEqual([
      {
        type: 'screen',
        id: 'scr-home',
        name: 'Business Home',
        via: ['id'],
        versionId: 'v1',
      },
      {
        type: 'layout',
        id: 'lay-main',
        name: 'Main Layout',
        via: ['id'],
        versionId: 'v3',
      },
    ])
  })

  it('counts drop when the reference is removed, not before', () => {
    expect(
      scanComponentUsage('cmp-footer', { screens, layouts, components }),
    ).toHaveLength(2)
    // Take the instance out of the screen only.
    const edited = screens.map((screen) =>
      screen.id === 'scr-home' ? { ...screen, nodes: emptyTree } : screen,
    )
    const after = scanComponentUsage('cmp-footer', {
      screens: edited,
      layouts,
      components,
    })
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ type: 'layout', id: 'lay-main' })
  })

  it('finds a component used ONLY inside another component', () => {
    // The trap this scan exists to avoid: cmp-badge sits on no screen at
    // all, but the renderer still expands it inside Product Card, so
    // "used nowhere" would be a lie that invites deleting it.
    const found = scanComponentUsage('cmp-badge', {
      screens,
      layouts,
      components,
    })
    expect(found).toEqual([
      { type: 'component', id: 'cmp-card', name: 'Product Card', via: ['id'] },
    ])
  })

  it('ignores deleted dependents and never reports self-use', () => {
    const withDeleted: UsageCandidate[] = [
      ...screens,
      {
        id: 'scr-old',
        displayName: 'Retired',
        versionId: 'v9',
        deletedAt: { seconds: 1 },
        nodes: treeWithInstance('cmp-footer'),
      },
    ]
    const found = scanComponentUsage('cmp-footer', {
      screens: withDeleted,
      layouts,
      components,
    })
    expect(found.map((entry) => entry.id)).toEqual(['scr-home', 'lay-main'])

    // A definition containing an instance of ITSELF must not list itself.
    const selfRef: UsageCandidate[] = [
      { id: 'cmp-loop', displayName: 'Loop', nodes: treeWithInstance('cmp-loop') },
    ]
    expect(
      scanComponentUsage('cmp-loop', {
        screens: [],
        layouts: [],
        components: selfRef,
      }),
    ).toEqual([])
  })

  it('returns nothing for a blank id rather than matching everything', () => {
    expect(
      scanComponentUsage('', { screens, layouts, components }),
    ).toEqual([])
  })
})

describe('scanLayoutUsage', () => {
  const screens: UsageCandidate[] = [
    { id: 'scr-home', displayName: 'Business Home', layoutId: 'lay-main', versionId: 'v1' },
    { id: 'scr-shop', displayName: 'Shop', layoutId: 'lay-main' },
    { id: 'scr-docs', displayName: 'Docs', layoutId: 'lay-docs', versionId: 'v3' },
    { id: 'scr-none', displayName: 'Standalone' },
    {
      id: 'scr-old',
      displayName: 'Retired',
      layoutId: 'lay-main',
      deletedAt: { seconds: 1 },
    },
  ]

  const layouts: UsageCandidate[] = [
    // Nested inside lay-main (AGL-703).
    { id: 'lay-inner', displayName: 'Inner Layout', layoutId: 'lay-main' },
    { id: 'lay-main', displayName: 'Main Layout' },
    {
      id: 'lay-gone',
      displayName: 'Retired Layout',
      layoutId: 'lay-main',
      deletedAt: { seconds: 1 },
    },
  ]

  it('lists a layout nested inside this one as a dependent', () => {
    const found = scanLayoutUsage('lay-main', screens, layouts)
    expect(found).toContainEqual({
      type: 'layout',
      id: 'lay-inner',
      name: 'Inner Layout',
      via: ['id'],
    })
    // Deleted nested layouts are not dependents.
    expect(found.some((entry) => entry.id === 'lay-gone')).toBe(false)
    // A layout is never its own dependent, however the data reads.
    expect(found.some((entry) => entry.id === 'lay-main')).toBe(false)
  })

  it('lists every live screen rendering inside the layout', () => {
    const found = scanLayoutUsage('lay-main', screens)
    expect(found).toEqual([
      {
        type: 'screen',
        id: 'scr-home',
        name: 'Business Home',
        via: ['id'],
        versionId: 'v1',
      },
      // No versionId: an unpublished screen still USES the layout, so it
      // has to appear — the card renders it as plain text, not a link.
      { type: 'screen', id: 'scr-shop', name: 'Shop', via: ['id'] },
    ])
  })

  it('reports an unused layout as unused', () => {
    expect(scanLayoutUsage('lay-orphan', screens)).toEqual([])
  })

  it('does not treat a screen with no layout as using every layout', () => {
    expect(scanLayoutUsage('', screens)).toEqual([])
    expect(
      scanLayoutUsage('lay-main', screens).some((e) => e.id === 'scr-none'),
    ).toBe(false)
  })
})

/* ---- plugin placements (AGL-1027) ---- */

/** A tree holding `count` nodes contributed by `pluginId`. */
const treeWithPlugin = (pluginId: string, count = 1) => {
  const tree: Record<string, any> = {
    root: {
      $id: 'root',
      componentId: 'div',
      pluginId: 'mui',
      nodes: Array.from({ length: count }, (_, index) => `p${index}`),
    },
  }
  for (let index = 0; index < count; index += 1) {
    tree[`p${index}`] = {
      $id: `p${index}`,
      componentId: 'countdown',
      pluginId,
      parentId: 'root',
      nodes: [],
    }
  }
  return tree
}

describe('scanPluginPlacements (AGL-1027)', () => {
  const none = { screens: [], layouts: [], components: [] }

  it('finds nothing for a plugin nobody placed', () => {
    expect(
      scanPluginPlacements('promo', {
        ...none,
        screens: [{ id: 's1', displayName: 'Home', nodes: emptyTree, versionId: 'v1' }],
      }),
    ).toEqual({ placements: [], affectedScreenIds: [] })
  })

  it('does not match a DIFFERENT plugin’s nodes', () => {
    const screens = [
      { id: 's1', displayName: 'Home', nodes: treeWithPlugin('promo'), versionId: 'v1' },
    ]
    expect(
      scanPluginPlacements('countdown-pro', { ...none, screens }).placements,
    ).toEqual([])
  })

  it('counts how many of the plugin’s nodes a page holds', () => {
    const screens = [
      {
        id: 's1',
        displayName: 'Home',
        nodes: treeWithPlugin('promo', 3),
        versionId: 'v1',
      },
    ]
    const result = scanPluginPlacements('promo', { ...none, screens })
    expect(result.placements).toEqual([
      { type: 'screen', id: 's1', name: 'Home', count: 3, versionId: 'v1' },
    ])
    expect(result.affectedScreenIds).toEqual(['s1'])
  })

  it('skips a soft-deleted page', () => {
    const screens = [
      {
        id: 's1',
        displayName: 'Home',
        nodes: treeWithPlugin('promo'),
        versionId: 'v1',
        deletedAt: 'yesterday',
      },
    ]
    expect(scanPluginPlacements('promo', { ...none, screens }).placements).toEqual(
      [],
    )
  })

  it('a plugin in LAYOUT chrome affects every screen under it', () => {
    const screens: UsageCandidate[] = [
      { id: 's1', displayName: 'Home', nodes: emptyTree, layoutId: 'lay', versionId: 'v1' },
      { id: 's2', displayName: 'Shop', nodes: emptyTree, layoutId: 'lay', versionId: 'v1' },
      { id: 's3', displayName: 'Alone', nodes: emptyTree, versionId: 'v1' },
    ]
    const layouts: UsageCandidate[] = [
      { id: 'lay', displayName: 'Main', nodes: treeWithPlugin('promo'), versionId: 'v1' },
    ]
    const result = scanPluginPlacements('promo', { ...none, screens, layouts })
    expect(result.placements).toEqual([
      { type: 'layout', id: 'lay', name: 'Main', count: 1, versionId: 'v1' },
    ])
    // One placement, two live pages — the number the confirmation must quote.
    expect(result.affectedScreenIds.sort()).toEqual(['s1', 's2'])
  })

  it('follows a NESTED layout, so a parent’s chrome reaches the whole tree', () => {
    const screens: UsageCandidate[] = [
      { id: 's1', displayName: 'Home', nodes: emptyTree, layoutId: 'child', versionId: 'v1' },
    ]
    const layouts: UsageCandidate[] = [
      { id: 'parent', displayName: 'Parent', nodes: treeWithPlugin('promo'), versionId: 'v1' },
      { id: 'child', displayName: 'Child', nodes: emptyTree, layoutId: 'parent', versionId: 'v1' },
    ]
    expect(
      scanPluginPlacements('promo', { ...none, screens, layouts })
        .affectedScreenIds,
    ).toEqual(['s1'])
  })

  it('a plugin inside a reusable component reaches the screens placing it', () => {
    const screens: UsageCandidate[] = [
      { id: 's1', displayName: 'Home', nodes: treeWithInstance('cmp'), versionId: 'v1' },
      { id: 's2', displayName: 'Other', nodes: emptyTree, versionId: 'v1' },
    ]
    const components: UsageCandidate[] = [
      { id: 'cmp', displayName: 'Hero', nodes: treeWithPlugin('promo') },
    ]
    const result = scanPluginPlacements('promo', { ...none, screens, components })
    expect(result.placements).toEqual([
      { type: 'component', id: 'cmp', name: 'Hero', count: 1 },
    ])
    expect(result.affectedScreenIds).toEqual(['s1'])
  })

  it('a component nobody publishes is a placement that breaks no live page', () => {
    const components: UsageCandidate[] = [
      { id: 'cmp', displayName: 'Unused hero', nodes: treeWithPlugin('promo') },
    ]
    const result = scanPluginPlacements('promo', { ...none, components })
    expect(result.placements).toHaveLength(1)
    // The distinction the issue asks for: something IS placed, but nothing a
    // visitor can reach stops working.
    expect(result.affectedScreenIds).toEqual([])
  })

  it('counts a screen once when it is reached two ways', () => {
    const screens: UsageCandidate[] = [
      {
        id: 's1',
        displayName: 'Home',
        nodes: { ...treeWithInstance('cmp'), ...treeWithPlugin('promo') },
        layoutId: 'lay',
        versionId: 'v1',
      },
    ]
    const layouts: UsageCandidate[] = [
      { id: 'lay', displayName: 'Main', nodes: treeWithPlugin('promo'), versionId: 'v1' },
    ]
    const components: UsageCandidate[] = [
      { id: 'cmp', displayName: 'Hero', nodes: treeWithPlugin('promo') },
    ]
    const result = scanPluginPlacements('promo', {
      screens,
      layouts,
      components,
    })
    expect(result.placements).toHaveLength(3)
    expect(result.affectedScreenIds).toEqual(['s1'])
  })

  it('is empty for a missing plugin id rather than matching everything', () => {
    const screens = [
      { id: 's1', displayName: 'Home', nodes: treeWithPlugin('promo'), versionId: 'v1' },
    ]
    expect(scanPluginPlacements('', { ...none, screens })).toEqual({
      placements: [],
      affectedScreenIds: [],
    })
  })
})

describe('countPluginNodes', () => {
  it('counts only the named plugin’s nodes', () => {
    expect(countPluginNodes(treeWithPlugin('promo', 2), 'promo')).toBe(2)
    expect(countPluginNodes(treeWithPlugin('promo', 2), 'other')).toBe(0)
  })

  it('is zero for nothing', () => {
    expect(countPluginNodes(null, 'promo')).toBe(0)
    expect(countPluginNodes(undefined, 'promo')).toBe(0)
    expect(countPluginNodes({}, 'promo')).toBe(0)
    expect(countPluginNodes(treeWithPlugin('promo'), '')).toBe(0)
  })
})
