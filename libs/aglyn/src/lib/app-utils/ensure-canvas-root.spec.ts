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
import { ensureCanvasRoot } from './ensure-canvas-root'

describe('ensureCanvasRoot (AGL-931)', () => {
  /**
   * The failure this exists to prevent: no root means the hierarchy renders
   * 'Invalid node' with Add Element disabled, so the document cannot be
   * repaired from the UI at all.
   */
  it('gives an empty map a root', () => {
    const tree = ensureCanvasRoot({})
    expect(tree[CANVAS_ROOT_ELEMENT_ID]).toBeDefined()
    expect(tree[CANVAS_ROOT_ELEMENT_ID].nodes).toEqual([])
  })

  it('gives an absent map a root', () => {
    expect(ensureCanvasRoot(undefined)[CANVAS_ROOT_ELEMENT_ID]).toBeDefined()
  })

  it('leaves a rooted tree strictly untouched', () => {
    const rooted = {
      [CANVAS_ROOT_ELEMENT_ID]: {
        $id: CANVAS_ROOT_ELEMENT_ID,
        componentId: 'div',
        nodes: ['hero'],
      },
      hero: { $id: 'hero', componentId: 'box', parentId: CANVAS_ROOT_ELEMENT_ID },
    }
    expect(ensureCanvasRoot(rooted)).toBe(rooted)
  })

  /**
   * Recovering into an editable document beats discarding content: a screen
   * repaired this way ends up in the shape it should have had all along.
   */
  it('adopts existing content rather than replacing it', () => {
    const tree = ensureCanvasRoot({
      hero: { $id: 'hero', componentId: 'box', parentId: null, nodes: ['title'] },
      title: { $id: 'title', componentId: 'text', parentId: 'hero' },
    })
    expect(tree[CANVAS_ROOT_ELEMENT_ID].nodes).toEqual(['hero'])
    expect(tree['hero'].parentId).toBe(CANVAS_ROOT_ELEMENT_ID)
    // Nodes that already had a real parent keep it.
    expect(tree['title'].parentId).toBe('hero')
  })

  it('adopts every root, not just the first', () => {
    const tree = ensureCanvasRoot({
      a: { $id: 'a', componentId: 'box' },
      b: { $id: 'b', componentId: 'box' },
    })
    expect(tree[CANVAS_ROOT_ELEMENT_ID].nodes).toEqual(['a', 'b'])
  })

  /** A parent outside the map is no parent — that node is a root too. */
  it('treats a parent outside the map as no parent', () => {
    const tree = ensureCanvasRoot({
      hero: { $id: 'hero', componentId: 'box', parentId: 'gone' },
    })
    expect(tree[CANVAS_ROOT_ELEMENT_ID].nodes).toEqual(['hero'])
    expect(tree['hero'].parentId).toBe(CANVAS_ROOT_ELEMENT_ID)
  })
})
