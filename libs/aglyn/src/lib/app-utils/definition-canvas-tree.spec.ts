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

  it('does nothing with an empty definition', () => {
    expect(definitionToCanvasTree({ nodes: {} })).toEqual({})
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
