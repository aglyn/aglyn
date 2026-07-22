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
  scanComponentUsage,
  scanLayoutUsage,
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
