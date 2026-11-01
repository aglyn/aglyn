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

import { applyLayoutProps } from './compose-layout-props'
import {
  isNodeHiddenByHost,
  pruneHiddenNodes,
  pruneHostHiddenNodes,
} from './compose-reusable-components'

/**
 * AGL-4119: the visibility directives bound to a `{{host.*}}` token. A page's
 * own values are read when a layout or component is applied; the site's fill
 * in later, so a directive naming one has to live that long.
 */

const ROOT = '_@_'
const tree = (props: Record<string, unknown>, extra: Record<string, Record<string, unknown>> = {}) =>
  ({
    [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['box'] },
    box: { $id: 'box', componentId: 'muiBox', props, nodes: ['leaf'] },
    leaf: { $id: 'leaf', componentId: 'muiTypography', props: { children: 'Hi' }, nodes: [] },
    ...extra,
  }) as never

describe('isNodeHiddenByHost', () => {
  const withLogo = { logoUrl: 'media:h/a' }
  it('reads hideUnless and hideIf against the site', () => {
    expect(isNodeHiddenByHost({ hideUnless: '{{host.logo}}' }, {})).toBe(true)
    expect(isNodeHiddenByHost({ hideUnless: '{{host.logo}}' }, withLogo)).toBe(false)
    expect(isNodeHiddenByHost({ hideIf: '{{host.logo}}' }, withLogo)).toBe(true)
    expect(isNodeHiddenByHost({ hideIf: '{{host.logo}}' }, {})).toBe(false)
  })

  it('reads no site as a site with nothing set', () => {
    expect(isNodeHiddenByHost({ hideUnless: '{{host.logo}}' }, null)).toBe(true)
    expect(isNodeHiddenByHost({ hideIf: '{{host.logo}}' }, null)).toBe(false)
  })

  it('leaves a literal value alone, which only a graft reads', () => {
    expect(isNodeHiddenByHost({ hideIf: 'true' }, withLogo)).toBe(false)
    expect(isNodeHiddenByHost({ hideUnless: '' }, withLogo)).toBe(false)
    expect(isNodeHiddenByHost(undefined, withLogo)).toBe(false)
  })
})

describe('pruneHiddenNodes keeps a directive that waits for the site', () => {
  it('neither reads nor strips one bound to a host token', () => {
    const pruned = pruneHiddenNodes(tree({ hideUnless: '{{host.logo}}' }), ROOT) as Record<string, any>
    expect(pruned['box'].props).toEqual({ hideUnless: '{{host.logo}}' })
  })

  it('still reads and strips a directive whose value is known', () => {
    const shown = pruneHiddenNodes(tree({ hideIf: '' }), ROOT) as Record<string, any>
    expect(shown['box'].props).toEqual({})
    const hidden = pruneHiddenNodes(tree({ hideIf: 'true' }), ROOT) as Record<string, any>
    expect(hidden['box']).toBeUndefined()
    expect(hidden['leaf']).toBeUndefined()
  })

  it('carries one through a layout’s own props', () => {
    const applied = applyLayoutProps(tree({ hideIf: '{{host.logo}}' }), null, null) as Record<string, any>
    expect(applied['box'].props).toEqual({ hideIf: '{{host.logo}}' })
  })
})

describe('pruneHostHiddenNodes', () => {
  it('drops what the site hides, with what is inside it and its place in its parent', () => {
    const pruned = pruneHostHiddenNodes(tree({ hideUnless: '{{host.logo}}' }), {}) as Record<string, any>
    expect(pruned['box']).toBeUndefined()
    expect(pruned['leaf']).toBeUndefined()
    expect(pruned[ROOT].nodes).toEqual([])
  })

  it('keeps what the site shows, without its directive', () => {
    const pruned = pruneHostHiddenNodes(tree({ hideUnless: '{{host.logo}}' }), {
      logoUrl: 'media:h/a',
    }) as Record<string, any>
    expect(pruned['box'].props).toEqual({})
    expect(pruned['leaf']).toBeDefined()
  })

  it('answers the same tree when no node names the site, at the cost of a scan', () => {
    const nodes = tree({ hideIf: 'true' })
    expect(pruneHostHiddenNodes(nodes, { logoUrl: 'media:h/a' })).toBe(nodes)
  })

  it('leaves a page’s own literal directive as inert as it was', () => {
    const nodes = tree({ hideUnless: '{{host.logo}}' }, {
      other: { $id: 'other', componentId: 'muiBox', props: { hideIf: 'true' }, nodes: [] },
    }) as Record<string, any>
    nodes[ROOT].nodes = ['box', 'other']
    const pruned = pruneHostHiddenNodes(nodes as never, { logoUrl: 'media:h/a' }) as Record<string, any>
    expect(pruned['other'].props).toEqual({ hideIf: 'true' })
  })
})
