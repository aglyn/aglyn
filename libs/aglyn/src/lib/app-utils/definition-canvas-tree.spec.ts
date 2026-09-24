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
import { CANVAS_ROOT_ELEMENT_ID } from '../foundation/constants/canvas'
import {
  canvasTreeToDefinition,
  definitionToCanvasTree,
  nestedToDefinition,
} from './definition-canvas-tree'

/** What `promoteToComponent` actually stores: root is the selected node. */
const definition: { rootId: string; nodes: Record<string, any> } = {
  rootId: 'hero',
  nodes: {
    hero: { $id: 'hero', componentId: 'box', parentId: null, nodes: ['title'] },
    title: { $id: 'title', componentId: 'text', parentId: 'hero' },
  },
}

describe('definitionToCanvasTree (AGL-680)', () => {
  it('wraps a definition under the canonical canvas root', () => {
    const tree = definitionToCanvasTree(definition)
    expect(tree[CANVAS_ROOT_ELEMENT_ID]).toBeDefined()
    expect(tree[CANVAS_ROOT_ELEMENT_ID].nodes).toEqual(['hero'])
    // The old root becomes a child rather than a second parentless node.
    expect(tree['hero'].parentId).toBe(CANVAS_ROOT_ELEMENT_ID)
  })

  it('leaves an already canvas-shaped tree untouched', () => {
    const canvasShaped = {
      [CANVAS_ROOT_ELEMENT_ID]: {
        $id: CANVAS_ROOT_ELEMENT_ID,
        componentId: 'box',
        nodes: ['hero'],
      },
      hero: { $id: 'hero', componentId: 'box', parentId: CANVAS_ROOT_ELEMENT_ID },
    }
    expect(definitionToCanvasTree({ rootId: 'hero', nodes: canvasShaped })).toBe(
      canvasShaped,
    )
  })

  it('falls back to the parentless node when rootId is missing or stale', () => {
    const tree = definitionToCanvasTree({ rootId: 'gone', nodes: definition.nodes })
    expect(tree[CANVAS_ROOT_ELEMENT_ID].nodes).toEqual(['hero'])
  })

  /**
   * The editor has no way back from a rootless canvas: the hierarchy shows
   * `'Invalid node'` and Add Element is disabled, so a component stored this
   * way could never be repaired from the UI (AGL-753). Everything created
   * before AGL-693 is stored as exactly this.
   */
  it('gives an empty definition an empty canvas root, not nothing', () => {
    const tree = definitionToCanvasTree({ nodes: {} })
    expect(tree[CANVAS_ROOT_ELEMENT_ID]).toBeDefined()
    expect(tree[CANVAS_ROOT_ELEMENT_ID].nodes).toEqual([])
  })

  it('gives an absent definition an empty canvas root', () => {
    expect(
      definitionToCanvasTree({ rootId: undefined, nodes: undefined })[
        CANVAS_ROOT_ELEMENT_ID
      ],
    ).toBeDefined()
  })

  /**
   * `promoteToComponent` walks a selected subtree, so the promoted root can
   * keep pointing at the parent it had in the screen it came from. That
   * parent is not in the definition, which makes the node a root even though
   * it has a `parentId` (AGL-753).
   */
  it('treats a parent outside the map as no parent', () => {
    const tree = definitionToCanvasTree({
      nodes: {
        hero: {
          $id: 'hero',
          componentId: 'box',
          parentId: 'screen-section-gone',
          nodes: ['title'],
        },
        title: { $id: 'title', componentId: 'text', parentId: 'hero' },
      },
    })
    expect(tree[CANVAS_ROOT_ELEMENT_ID].nodes).toEqual(['hero'])
    expect(tree['hero'].parentId).toBe(CANVAS_ROOT_ELEMENT_ID)
  })
})

describe('canvasTreeToDefinition (AGL-680)', () => {
  it('round-trips a definition without loss', () => {
    const back = canvasTreeToDefinition(definitionToCanvasTree(definition))
    expect(back.ambiguousRoot).toBe(false)
    expect(back.rootId).toBe('hero')
    expect(back.nodes[CANVAS_ROOT_ELEMENT_ID]).toBeUndefined()
    expect(back.nodes['hero'].parentId).toBeNull()
    expect(back.nodes['title'].parentId).toBe('hero')
  })

  /**
   * The wrapper must never reach the tenant runtime: it grafts from
   * `rootId`, so publishing the synthetic root would put an always-empty
   * container inside every instance of the component.
   */
  it('never publishes the synthetic root', () => {
    const back = canvasTreeToDefinition(definitionToCanvasTree(definition))
    expect(Object.keys(back.nodes)).toEqual(['hero', 'title'])
  })

  /**
   * Several top-level children means there is no single definition root to
   * name. Reporting it lets the caller refuse, rather than silently
   * publishing only the first child and losing the rest.
   */
  it('reports an ambiguous root instead of guessing', () => {
    const tree = {
      [CANVAS_ROOT_ELEMENT_ID]: {
        $id: CANVAS_ROOT_ELEMENT_ID,
        componentId: 'box',
        nodes: ['a', 'b'],
      },
      a: { $id: 'a', componentId: 'box', parentId: CANVAS_ROOT_ELEMENT_ID },
      b: { $id: 'b', componentId: 'box', parentId: CANVAS_ROOT_ELEMENT_ID },
    }
    expect(canvasTreeToDefinition(tree).ambiguousRoot).toBe(true)
  })

  it('handles a tree that never had a wrapper', () => {
    const back = canvasTreeToDefinition(definition.nodes)
    expect(back.rootId).toBe('hero')
    expect(back.ambiguousRoot).toBe(false)
  })

  it('tolerates an absent tree', () => {
    expect(canvasTreeToDefinition(undefined).nodes).toEqual({})
  })
})

/**
 * A component seeded from an element preset (AGL-3287): the Components page
 * starts a Header or Footer email block from the same preset an author drops
 * into an email, so the nested tree has to come out as the definition shape
 * the editor and the graft read.
 */
describe('nestedToDefinition (AGL-3287)', () => {
  /** A preset's `data`: every id is `null` until the tree is placed. */
  const unplaced = null as string | null
  const preset = {
    $id: unplaced,
    componentId: 'section',
    pluginId: 'spec',
    props: { align: 'center' },
    nodes: [
      { $id: unplaced, componentId: 'image', pluginId: 'spec', props: { alt: 'Logo' } },
      { $id: unplaced, componentId: 'text', pluginId: 'spec', props: { children: 'Hi' } },
    ],
  }

  const ids = () => {
    let next = 0
    return () => `n${++next}`
  }

  it('keys every element by a fresh id and names the outermost one the root', () => {
    const { rootId, nodes } = nestedToDefinition(preset, ids())
    expect(rootId).toBe('n1')
    expect(nodes['n1']).toEqual({
      $id: 'n1',
      componentId: 'section',
      pluginId: 'spec',
      props: { align: 'center' },
      parentId: null,
      nodes: ['n2', 'n3'],
    })
    expect(nodes['n2']).toEqual({
      $id: 'n2',
      componentId: 'image',
      pluginId: 'spec',
      props: { alt: 'Logo' },
      parentId: 'n1',
    })
    expect(nodes['n3'].parentId).toBe('n1')
  })

  it('opens in the editor as the same tree, under the canvas root', () => {
    const tree = definitionToCanvasTree(nestedToDefinition(preset, ids()))
    expect(tree[CANVAS_ROOT_ELEMENT_ID].nodes).toEqual(['n1'])
    // And publishing unwraps it back to the preset's own outer element.
    expect(canvasTreeToDefinition(tree).rootId).toBe('n1')
  })

  it('copies the preset rather than sharing its values', () => {
    const { nodes } = nestedToDefinition(preset, ids())
    nodes['n1'].props.align = 'left'
    expect(preset.props.align).toBe('center')
  })
})
