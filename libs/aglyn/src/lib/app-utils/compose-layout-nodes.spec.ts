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

import type { AglynNodeSchema } from '../foundation'
import {
  canNestLayout,
  composeLayoutAndScreenNodes,
  composeLayoutChainAndScreenNodes,
  LAYOUT_NODE_ID_PREFIX,
  LAYOUT_SLOT_COMPONENT_ID,
  layoutNodeIdPrefix,
  MAX_LAYOUT_CHAIN_DEPTH,
  resolveLayoutChainIds,
} from './compose-layout-nodes'

const ROOT = '_@_'

const layoutNodes: Record<string, AglynNodeSchema> = {
  [ROOT]: { $id: ROOT, componentId: 'root', nodes: ['appbar', 'slot', 'footer'] },
  appbar: { $id: 'appbar', componentId: 'muiAppBar', parentId: ROOT },
  slot: { $id: 'slot', componentId: LAYOUT_SLOT_COMPONENT_ID, parentId: ROOT },
  footer: { $id: 'footer', componentId: 'muiToolbar', parentId: ROOT },
}

const screenNodes: Record<string, AglynNodeSchema> = {
  [ROOT]: { $id: ROOT, componentId: 'root', nodes: ['hero', 'body'] },
  hero: { $id: 'hero', componentId: 'muiContainer', parentId: ROOT, nodes: ['heroText'] },
  heroText: { $id: 'heroText', componentId: 'muiTypography', parentId: 'hero' },
  body: { $id: 'body', componentId: 'muiContainer', parentId: ROOT },
}

describe('composeLayoutAndScreenNodes', () => {
  it('returns screen nodes unchanged without layout nodes or a slot', () => {
    expect(composeLayoutAndScreenNodes(undefined, screenNodes)).toBe(
      screenNodes,
    )
    const slotless = {
      [ROOT]: layoutNodes[ROOT],
      appbar: layoutNodes['appbar'],
    }
    expect(composeLayoutAndScreenNodes(slotless, screenNodes)).toBe(screenNodes)
  })

  it('grafts screen children into the slot under the layout root', () => {
    const composed = composeLayoutAndScreenNodes(layoutNodes, screenNodes)
    const slotId = `${LAYOUT_NODE_ID_PREFIX}slot`

    // Layout root keeps its structure with prefixed child ids.
    expect(composed[ROOT].nodes).toEqual([
      `${LAYOUT_NODE_ID_PREFIX}appbar`,
      slotId,
      `${LAYOUT_NODE_ID_PREFIX}footer`,
    ])
    // The slot holds the screen root's children, repointed at the slot.
    expect(composed[slotId].nodes).toEqual(['hero', 'body'])
    expect(composed['hero'].parentId).toBe(slotId)
    expect(composed['body'].parentId).toBe(slotId)
    // Nested screen nodes are untouched.
    expect(composed['heroText'].parentId).toBe('hero')
    // The screen's own root is dropped.
    expect(Object.values(composed).filter((n) => n.$id === ROOT)).toHaveLength(1)
  })

  it('does not mutate its inputs', () => {
    const layoutCopy = JSON.parse(JSON.stringify(layoutNodes))
    const screenCopy = JSON.parse(JSON.stringify(screenNodes))
    composeLayoutAndScreenNodes(layoutNodes, screenNodes)
    expect(layoutNodes).toEqual(layoutCopy)
    expect(screenNodes).toEqual(screenCopy)
  })

  it('keeps chrome that was left inside the slot above the screen content', () => {
    const layoutWithSlotChrome: Record<string, AglynNodeSchema> = {
      [ROOT]: { $id: ROOT, componentId: 'root', nodes: ['slot'] },
      slot: {
        $id: 'slot',
        componentId: LAYOUT_SLOT_COMPONENT_ID,
        parentId: ROOT,
        nodes: ['appbar'],
      },
      appbar: { $id: 'appbar', componentId: 'muiAppBar', parentId: 'slot' },
    }
    const composed = composeLayoutAndScreenNodes(
      layoutWithSlotChrome,
      screenNodes,
    )
    const slotId = `${LAYOUT_NODE_ID_PREFIX}slot`
    expect(composed[slotId].nodes).toEqual([
      `${LAYOUT_NODE_ID_PREFIX}appbar`,
      'hero',
      'body',
    ])
    expect(composed[`${LAYOUT_NODE_ID_PREFIX}appbar`].parentId).toBe(slotId)
  })

  it('avoids id collisions between layout and screen nodes', () => {
    const collidingLayout: Record<string, AglynNodeSchema> = {
      [ROOT]: { $id: ROOT, componentId: 'root', nodes: ['hero', 'slot'] },
      hero: { $id: 'hero', componentId: 'muiAppBar', parentId: ROOT },
      slot: {
        $id: 'slot',
        componentId: LAYOUT_SLOT_COMPONENT_ID,
        parentId: ROOT,
      },
    }
    const composed = composeLayoutAndScreenNodes(collidingLayout, screenNodes)
    // Layout's "hero" is prefixed; screen's "hero" survives untouched.
    expect(composed[`${LAYOUT_NODE_ID_PREFIX}hero`].componentId).toBe(
      'muiAppBar',
    )
    expect(composed['hero'].componentId).toBe('muiContainer')
  })

  it('pins the root to a renderable container when the stored root has none', () => {
    const bareRootLayout: Record<string, AglynNodeSchema> = {
      [ROOT]: { $id: ROOT, nodes: ['slot'] } as AglynNodeSchema,
      slot: {
        $id: 'slot',
        componentId: LAYOUT_SLOT_COMPONENT_ID,
        parentId: ROOT,
      },
    }
    const composed = composeLayoutAndScreenNodes(bareRootLayout, screenNodes)
    expect(composed[ROOT].componentId).toBe('div')

    // A stored root componentId is respected.
    const composedKept = composeLayoutAndScreenNodes(layoutNodes, screenNodes)
    expect(composedKept[ROOT].componentId).toBe('root')
  })
})

/* ── Nested layouts (AGL-703) ──────────────────────────────────────── */

/** A layout whose own nodes deliberately reuse the inner layout's ids. */
const outerLayoutNodes: Record<string, AglynNodeSchema> = {
  [ROOT]: { $id: ROOT, componentId: 'root', nodes: ['appbar', 'slot'] },
  appbar: { $id: 'appbar', componentId: 'muiDrawer', parentId: ROOT },
  slot: { $id: 'slot', componentId: LAYOUT_SLOT_COMPONENT_ID, parentId: ROOT },
}

describe('composeLayoutChainAndScreenNodes', () => {
  it('nests a layout inside a layout, outermost at the root', () => {
    const composed = composeLayoutChainAndScreenNodes(
      [layoutNodes, outerLayoutNodes],
      screenNodes,
    )
    const inner = layoutNodeIdPrefix(1)
    const outer = layoutNodeIdPrefix(2)

    // Outermost layout owns the root, and its chrome is there.
    expect(composed[ROOT].componentId).toBe('root')
    expect(composed[`${outer}appbar`].componentId).toBe('muiDrawer')
    // The inner layout hangs off the outer layout's slot.
    expect(composed[`${inner}${ROOT}`]).toBeUndefined()
    expect(composed[`${outer}slot`].nodes).toContain(`${inner}appbar`)
    // Screen content is still inside the INNER layout's slot.
    expect(composed[`${inner}slot`].nodes).toEqual(['hero', 'body'])
    expect(composed['hero'].parentId).toBe(`${inner}slot`)
  })

  it('keeps two layouts sharing a node id distinct', () => {
    const composed = composeLayoutChainAndScreenNodes(
      [layoutNodes, outerLayoutNodes],
      screenNodes,
    )
    // Both layouts have an "appbar"; a single shared prefix would have
    // collapsed them into one node and lost the inner layout's chrome.
    expect(composed[`${layoutNodeIdPrefix(1)}appbar`].componentId).toBe(
      'muiAppBar',
    )
    expect(composed[`${layoutNodeIdPrefix(2)}appbar`].componentId).toBe(
      'muiDrawer',
    )
  })

  it('matches the single-layout result for a chain of one', () => {
    expect(composeLayoutChainAndScreenNodes([layoutNodes], screenNodes)).toEqual(
      composeLayoutAndScreenNodes(layoutNodes, screenNodes),
    )
    // ...and depth 1 keeps the original prefix, so interactions authored
    // before nesting existed still match.
    expect(layoutNodeIdPrefix(1)).toBe(LAYOUT_NODE_ID_PREFIX)
  })

  it('passes the tree through a slotless layout instead of dropping outer ones', () => {
    const slotless: Record<string, AglynNodeSchema> = {
      [ROOT]: { $id: ROOT, componentId: 'root', nodes: ['only'] },
      only: { $id: 'only', componentId: 'muiBox', parentId: ROOT },
    }
    const composed = composeLayoutChainAndScreenNodes(
      [slotless, outerLayoutNodes],
      screenNodes,
    )
    // The broken middle layout contributes nothing, but the outer layout
    // still wraps the screen rather than being skipped along with it.
    expect(composed[`${layoutNodeIdPrefix(2)}appbar`].componentId).toBe(
      'muiDrawer',
    )
    expect(composed[`${layoutNodeIdPrefix(2)}slot`].nodes).toEqual([
      'hero',
      'body',
    ])
  })

  it('never composes more than the depth cap', () => {
    const chain = Array.from({ length: 10 }, () => outerLayoutNodes)
    const composed = composeLayoutChainAndScreenNodes(chain, screenNodes)
    expect(
      composed[`${layoutNodeIdPrefix(MAX_LAYOUT_CHAIN_DEPTH)}appbar`],
    ).toBeDefined()
    expect(
      composed[`${layoutNodeIdPrefix(MAX_LAYOUT_CHAIN_DEPTH + 1)}appbar`],
    ).toBeUndefined()
  })
})

describe('resolveLayoutChainIds', () => {
  const parents: Record<string, string | undefined> = {
    a: 'b',
    b: 'c',
    c: undefined,
  }
  const parentOf = (id: string) => parents[id]

  it('walks innermost to outermost', () => {
    expect(resolveLayoutChainIds('a', parentOf)).toEqual(['a', 'b', 'c'])
    expect(resolveLayoutChainIds('c', parentOf)).toEqual(['c'])
    expect(resolveLayoutChainIds(undefined, parentOf)).toEqual([])
  })

  it('stops on a self-reference rather than recursing', () => {
    expect(resolveLayoutChainIds('loop', () => 'loop')).toEqual(['loop'])
  })

  it('stops on an indirect cycle, which self-reference checks alone miss', () => {
    const cyclic: Record<string, string> = { x: 'y', y: 'z', z: 'x' }
    expect(resolveLayoutChainIds('x', (id) => cyclic[id])).toEqual([
      'x',
      'y',
      'z',
    ])
  })

  it('caps an unbounded chain', () => {
    // Every layout points at a fresh one — no cycle, just no end.
    let counter = 0
    const chain = resolveLayoutChainIds('start', () => `next-${counter++}`)
    expect(chain).toHaveLength(MAX_LAYOUT_CHAIN_DEPTH)
  })
})

describe('canNestLayout', () => {
  const parents: Record<string, string | undefined> = { a: 'b', b: 'c' }
  const parentOf = (id: string) => parents[id]

  it('refuses a layout inside itself', () => {
    expect(canNestLayout('a', 'a', parentOf)).toBe(false)
  })

  it('refuses a descendant, which would close a loop', () => {
    // 'a' already renders inside 'b' → 'c'. Putting 'c' inside 'a' would
    // make c → a → b → c.
    expect(canNestLayout('c', 'a', parentOf)).toBe(false)
    expect(canNestLayout('b', 'a', parentOf)).toBe(false)
  })

  it('allows an unrelated layout', () => {
    expect(canNestLayout('a', 'unrelated', parentOf)).toBe(true)
    expect(canNestLayout('unrelated', 'a', parentOf)).toBe(true)
  })

  it('refuses blank ids rather than treating them as a valid pair', () => {
    expect(canNestLayout('', 'a', parentOf)).toBe(false)
    expect(canNestLayout('a', '', parentOf)).toBe(false)
  })
})
