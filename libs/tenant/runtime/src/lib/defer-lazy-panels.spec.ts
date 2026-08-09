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
  DEFERRED_PANEL_PROP,
  deferLazyPanelNodes,
} from './defer-lazy-panels'

/** Tabs with `panels` labels, each panel holding `depth` nested children. */
const doc = (opts: {
  labels?: string
  ssrPanels?: boolean
  lazyPanels?: boolean
  panelLabels?: string[]
  panelOrder?: string[]
  /** Extra props on the Tabs node, e.g. the per-tab links of AGL-1312. */
  tabProps?: Record<string, any>
}): Record<string, any> => {
  const {
    labels = 'One\nTwo\nThree',
    ssrPanels = false,
    lazyPanels = false,
    panelLabels = ['One', 'Two', 'Three'],
  } = opts
  const order = opts.panelOrder ?? panelLabels
  const nodes: Record<string, any> = {
    root: { $id: 'root', componentId: 'section', nodes: ['tabs'] },
    tabs: {
      $id: 'tabs',
      componentId: 'muiTabs',
      parentId: 'root',
      props: {
        labels,
        ...(ssrPanels ? { ssrPanels: true } : {}),
        ...(lazyPanels ? { lazyPanels: true } : {}),
        ...(opts.tabProps ?? {}),
      },
      nodes: order.map((l) => `panel-${l}`),
    },
  }
  for (const label of panelLabels) {
    nodes[`panel-${label}`] = {
      $id: `panel-${label}`,
      componentId: 'muiTabPanel',
      parentId: 'tabs',
      props: { label },
      nodes: [`row-${label}`],
    }
    nodes[`row-${label}`] = {
      $id: `row-${label}`,
      componentId: 'section',
      parentId: `panel-${label}`,
      nodes: [`text-${label}`],
    }
    nodes[`text-${label}`] = {
      $id: `text-${label}`,
      componentId: 'muiTypography',
      parentId: `row-${label}`,
      props: { children: `${label} body` },
      nodes: [],
    }
  }
  return nodes
}

describe('deferLazyPanelNodes (AGL-1285)', () => {
  it('withholds every panel except the landing one', () => {
    const result = deferLazyPanelNodes(doc({}))
    expect(result.deferredPanelIds.sort()).toEqual([
      'panel-Three',
      'panel-Two',
    ])
    // Landing panel keeps its whole subtree.
    expect(result.nodes['row-One']).toBeDefined()
    expect(result.nodes['text-One']).toBeDefined()
    // The others lose theirs — 2 panels x 2 descendants.
    expect(result.nodes['row-Two']).toBeUndefined()
    expect(result.nodes['text-Two']).toBeUndefined()
    expect(result.removed).toBe(4)
  })

  it('keeps the panel nodes themselves, marked and childless', () => {
    const { nodes } = deferLazyPanelNodes(doc({}))
    // The tab strip, aria wiring and label all still need the panel to exist.
    expect(nodes['panel-Two']).toBeDefined()
    expect(nodes['panel-Two'].props.label).toBe('Two')
    expect(nodes['panel-Two'].props[DEFERRED_PANEL_PROP]).toBe(true)
    expect(nodes['panel-Two'].nodes).toEqual([])
  })

  it('defers by default — no opt-in required (AGL-1283 option 3)', () => {
    // `doc({})` authors NO mounting prop at all; deferral is the default.
    const result = deferLazyPanelNodes(doc({}))
    expect(result.removed).toBe(4)
  })

  it('does nothing when the author set ssrPanels — the SEO escape hatch', () => {
    const input = doc({ ssrPanels: true })
    const result = deferLazyPanelNodes(input)
    expect(result.removed).toBe(0)
    expect(result.nodes).toBe(input)
  })

  it('still defers documents carrying the legacy lazyPanels opt-in', () => {
    // Authored while lazy was opt-in (AGL-1283); the prop is subsumed by the
    // default and must not change the outcome.
    const result = deferLazyPanelNodes(doc({ lazyPanels: true }))
    expect(result.removed).toBe(4)
  })

  /**
   * The landing panel is whichever matches labels[0], NOT the first child.
   * Panels can be reordered in the hierarchy independently of the label list,
   * and pruning the open one leaves the reader on an empty tab.
   */
  it('follows the label list, not the child order', () => {
    const result = deferLazyPanelNodes(
      doc({ panelOrder: ['Three', 'Two', 'One'] }),
    )
    expect(result.nodes['text-One']).toBeDefined()
    expect(result.deferredPanelIds.sort()).toEqual([
      'panel-Three',
      'panel-Two',
    ])
  })

  /**
   * A tab carrying a screen link navigates instead of opening a panel
   * (AGL-1312), so the strip lands on the first tab WITHOUT one. Withholding
   * by the first LABEL would prune the panel the reader is actually looking
   * at — the client would then land on the "Loading…" placeholder.
   */
  it('lands where the client lands when the first tabs are links', () => {
    const result = deferLazyPanelNodes(
      doc({ tabProps: { tabLink1: 'screen-a' } }),
    )
    expect(result.nodes['text-Two']).toBeDefined()
    expect(result.deferredPanelIds.sort()).toEqual([
      'panel-One',
      'panel-Three',
    ])
  })

  it('falls back to the first label when every tab is a link', () => {
    // Nothing is really open; the client shows the first panel, so this
    // must keep the first panel too.
    const result = deferLazyPanelNodes(
      doc({
        tabProps: {
          tabLink1: 'screen-a',
          tabLink2: 'screen-b',
          tabLink3: 'screen-c',
        },
      }),
    )
    expect(result.nodes['text-One']).toBeDefined()
    expect(result.deferredPanelIds.sort()).toEqual([
      'panel-Three',
      'panel-Two',
    ])
  })

  it('matches labels case- and whitespace-insensitively', () => {
    const result = deferLazyPanelNodes(
      doc({ labels: '  one \nTwo', panelLabels: ['One', 'Two'] }),
    )
    expect(result.nodes['text-One']).toBeDefined()
    expect(result.deferredPanelIds).toEqual(['panel-Two'])
  })

  it('accepts the comma label form the mui plugin also accepts', () => {
    const result = deferLazyPanelNodes(
      doc({ labels: 'One, Two', panelLabels: ['One', 'Two'] }),
    )
    expect(result.deferredPanelIds).toEqual(['panel-Two'])
  })

  /**
   * Refusing to guess is the point: if no panel matches the first label the
   * set is mislabelled, and that is exactly when withholding the wrong subtree
   * is most expensive.
   */
  it('defers nothing when no panel matches the first label', () => {
    const input = doc({ labels: 'Nope\nTwo', panelLabels: ['One', 'Two'] })
    const result = deferLazyPanelNodes(input)
    expect(result.removed).toBe(0)
    expect(result.nodes).toBe(input)
  })

  it('defers nothing for a single-panel set', () => {
    const result = deferLazyPanelNodes(
      doc({ labels: 'One', panelLabels: ['One'] }),
    )
    expect(result.removed).toBe(0)
  })

  /**
   * The composed document is cached by `loadPageDataCached`. Mutating it would
   * poison every later request for the screen with a permanently half-empty
   * page — a bug that would only show up under cache hits.
   */
  it('never mutates the input', () => {
    const input = doc({})
    const snapshot = JSON.stringify(input)
    const result = deferLazyPanelNodes(input)
    expect(JSON.stringify(input)).toBe(snapshot)
    expect(result.nodes).not.toBe(input)
    expect(input['panel-Two'].nodes).toEqual(['row-Two'])
    expect(input['panel-Two'].props[DEFERRED_PANEL_PROP]).toBeUndefined()
  })

  it('leaves an unrelated document alone', () => {
    const input = {
      a: { $id: 'a', componentId: 'section', nodes: ['b'] },
      b: { $id: 'b', componentId: 'muiTypography', props: { children: 'hi' } },
    }
    const result = deferLazyPanelNodes(input)
    expect(result.nodes).toBe(input)
    expect(result.removed).toBe(0)
  })

  it('tolerates a null document', () => {
    expect(deferLazyPanelNodes(null).removed).toBe(0)
  })

  /** Deep subtrees must go in full, not just the panel's direct children. */
  it('removes the whole subtree, at any depth', () => {
    const input = doc({})
    input['text-Two'].nodes = ['deep']
    input['deep'] = {
      $id: 'deep',
      componentId: 'muiTypography',
      parentId: 'text-Two',
      props: { children: 'deep body' },
      nodes: [],
    }
    const result = deferLazyPanelNodes(input)
    expect(result.nodes['deep']).toBeUndefined()
    expect(result.removed).toBe(5)
  })
})
