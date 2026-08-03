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
  screenIdsUsingComponentDeep,
} from '../utils/server/scan-artifact-usage'

/**
 * Publishing a component has to drop the cache of every screen that renders it
 * (AGL-1161) — and "renders it" is a closure, not a level.
 *
 * A component reaches a screen three ways: directly, nested inside another
 * component, or through a layout whose chrome every screen below it renders.
 * A one-level answer is correct on the direct case, which is the only one
 * anyone tests by hand, so the other two are worth pinning hard. Getting them
 * wrong means a publish reports success while some pages serve the old
 * component for the full revalidate window — and the pages that DID drop
 * update instantly, which makes the survivors look like a browser cache
 * problem rather than a missing dependent.
 */
describe('screenIdsUsingComponentDeep (AGL-1161)', () => {
  /** A node tree holding one reusable instance of `refId`. */
  const uses = (refId: string) => ({
    n1: { componentId: 'reusableInstance', props: { refId } },
  })

  const screen = (
    id: string,
    opts: { uses?: string; layoutId?: string } = {},
  ) => ({
    id,
    ...(opts.uses ? { nodes: uses(opts.uses) } : {}),
    ...(opts.layoutId ? { layoutId: opts.layoutId } : {}),
  })
  const layout = (
    id: string,
    opts: { uses?: string; layoutId?: string } = {},
  ) => ({
    id,
    ...(opts.uses ? { nodes: uses(opts.uses) } : {}),
    ...(opts.layoutId ? { layoutId: opts.layoutId } : {}),
  })
  const component = (id: string, opts: { uses?: string } = {}) => ({
    id,
    ...(opts.uses ? { nodes: uses(opts.uses) } : {}),
  })

  const deep = (
    id: string,
    sources: Partial<Parameters<typeof screenIdsUsingComponentDeep>[1]>,
  ) =>
    screenIdsUsingComponentDeep(id, {
      screens: sources.screens ?? [],
      layouts: sources.layouts ?? [],
      components: sources.components ?? [],
    }).sort()

  it('finds screens that place the component directly', () => {
    const screens = [
      screen('s1', { uses: 'C' }),
      screen('s2', { uses: 'C' }),
      screen('s3', { uses: 'other' }),
    ]
    expect(deep('C', { screens })).toEqual(['s1', 's2'])
  })

  it('follows component→component nesting, which a level-only walk misses', () => {
    // `outer` embeds C; `s1` places `outer` and never mentions C.
    const screens = [screen('s1', { uses: 'outer' })]
    const components = [component('outer', { uses: 'C' })]

    // The single-level scan proves the gap: it reports the COMPONENT and no
    // screen, so a caller stopping there revalidates nothing at all.
    expect(
      scanComponentUsage('C', { screens, layouts: [], components }).map(
        (d) => d.id,
      ),
    ).toEqual(['outer'])

    expect(deep('C', { screens, components })).toEqual(['s1'])
  })

  it('follows several levels of component nesting', () => {
    const screens = [screen('s1', { uses: 'a' })]
    const components = [
      component('a', { uses: 'b' }),
      component('b', { uses: 'c' }),
      component('c', { uses: 'C' }),
    ]
    expect(deep('C', { screens, components })).toEqual(['s1'])
  })

  it('reaches every screen under a layout that uses the component', () => {
    // Chrome. The layout renders the component; no screen mentions it.
    const layouts = [layout('L', { uses: 'C' })]
    const screens = [screen('s1', { layoutId: 'L' }), screen('s2', { layoutId: 'L' })]
    expect(deep('C', { screens, layouts })).toEqual(['s1', 's2'])
  })

  it('reaches screens nested BELOW that layout — two closures composed', () => {
    // The component is in a parent layout, and the screen hangs off a child
    // layout. Needs the component walk to find the layout AND the layout walk
    // to descend from it; either alone returns nothing.
    const layouts = [layout('parent', { uses: 'C' }), layout('child', { layoutId: 'parent' })]
    const screens = [screen('deep', { layoutId: 'child' })]
    expect(deep('C', { screens, layouts })).toEqual(['deep'])
  })

  it('reaches a layout through a nested component', () => {
    // Component in a component in a layout. Both closures, chained.
    const layouts = [layout('L', { uses: 'outer' })]
    const components = [component('outer', { uses: 'C' })]
    const screens = [screen('s1', { layoutId: 'L' })]
    expect(deep('C', { screens, layouts, components })).toEqual(['s1'])
  })

  it('terminates on a component cycle rather than hanging the publish', () => {
    // The editor will not create this, but a document written straight to
    // Firestore is not bound by what the editor allows, and an unbounded walk
    // here hangs a request instead of surfacing anything.
    const components = [
      component('a', { uses: 'b' }),
      component('b', { uses: 'a' }),
    ]
    const screens = [screen('s1', { uses: 'a' })]
    expect(deep('a', { screens, components })).toEqual(['s1'])
  })

  it('terminates on a self-referencing component', () => {
    const components = [component('C', { uses: 'C' })]
    expect(deep('C', { components })).toEqual([])
  })

  it('skips deleted screens, layouts and components', () => {
    const screens = [
      { ...screen('gone', { uses: 'C' }), deletedAt: new Date() },
      screen('live', { uses: 'C' }),
      // Reachable only through a deleted component — must not be collected.
      screen('viaDeleted', { uses: 'deadWrapper' }),
    ]
    const components = [
      { ...component('deadWrapper', { uses: 'C' }), deletedAt: new Date() },
    ]
    expect(deep('C', { screens, components })).toEqual(['live'])
  })

  it('reports each screen once when it is reachable by several routes', () => {
    // Directly, and again through a wrapper. A duplicate would double-count
    // against the tenant route's path cap and could push real paths out.
    const screens = [screen('s1', { uses: 'C' })]
    const components = [component('outer', { uses: 'C' })]
    const screensBoth = [...screens, screen('s2', { uses: 'outer' })]
    expect(deep('C', { screens: screensBoth, components })).toEqual(['s1', 's2'])
    expect(deep('C', { screens: screensBoth, components })).toHaveLength(2)
  })

  it('returns nothing for an unused component, and for no id', () => {
    expect(deep('C', { screens: [screen('s1', { uses: 'other' })] })).toEqual([])
    expect(deep('', { screens: [screen('s1', { uses: 'C' })] })).toEqual([])
  })
})
