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

import * as Aglyn from '@aglyn/aglyn'
import DndManager, { DropRegion } from './dnd-manager'

const CONTAINER = 'testContainer'
const ITEM = 'testItem'
const LEAF = 'testLeaf'

const noopFactory = (() => null) as any

function registerSchemas() {
  Aglyn.components.registerComponent(noopFactory, {
    $id: CONTAINER,
    displayName: 'Container',
  })
  Aglyn.components.registerComponent(noopFactory, {
    $id: ITEM,
    displayName: 'Item',
  })
  // A text-editable component renders `children` as inline text and has no
  // node-children slot — the canonical "leaf" this fix guards against.
  Aglyn.components.registerComponent(noopFactory, {
    $id: LEAF,
    displayName: 'Leaf',
    flags: { textEditable: Aglyn.FEATURE_FLAG.ENABLED },
  })
}

function presetOf(): Aglyn.PresetSchema<any> {
  return {
    $id: 'preset-item',
    type: Aglyn.NodeType.PRESET,
    displayName: 'Item',
    data: { $id: null, componentId: ITEM, props: {} },
  } as any
}

/** Seed the canvas as: root -> outer -> [leaf, inner]. */
function seedCanvas() {
  Aglyn.canvas.reset()
  Aglyn.canvas.setNodes({
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      componentId: 'div',
      nodes: ['outer'],
    },
    outer: {
      $id: 'outer',
      componentId: CONTAINER,
      parentId: Aglyn.NODE_ROOT_ID,
      nodes: ['leaf', 'inner'],
    },
    leaf: {
      $id: 'leaf',
      componentId: LEAF,
      parentId: 'outer',
      nodes: [],
    },
    inner: {
      $id: 'inner',
      componentId: CONTAINER,
      parentId: 'outer',
      nodes: [],
    },
  } as any)
}

describe('DndManager leaf drop redirect (AGL-575 parallel)', () => {
  beforeEach(() => {
    registerSchemas()
    seedCanvas()
  })

  it('drops a preset on a leaf CHILDREN region as a sibling, not a child', () => {
    const dnd = new DndManager()
    dnd.setDragNode(presetOf())
    dnd.setDropNode(Aglyn.canvas.getNode('leaf'))
    dnd.setDropRegion(DropRegion.CHILDREN)
    dnd.onDragEnd()

    // The leaf itself gains nothing — the drop did not nest inside it.
    expect(Aglyn.canvas.getNode('leaf')!.nodes).toEqual([])

    // The new node lands under the leaf's parent, right after the leaf.
    const outer = Aglyn.canvas.getNode('outer')!
    expect(outer.nodes).toHaveLength(3)
    expect(outer.nodes![0]).toBe('leaf')
    const created = Aglyn.canvas.getNode(outer.nodes![1])!
    expect(created.componentId).toBe(ITEM)
    expect(created.parentId).toBe('outer')
  })

  it('drops a preset on a real container CHILDREN region as a nested child', () => {
    const dnd = new DndManager()
    dnd.setDragNode(presetOf())
    dnd.setDropNode(Aglyn.canvas.getNode('inner'))
    dnd.setDropRegion(DropRegion.CHILDREN)
    dnd.onDragEnd()

    // A container that accepts children still nests the drop inside itself.
    const inner = Aglyn.canvas.getNode('inner')!
    expect(inner.nodes).toHaveLength(1)
    const created = Aglyn.canvas.getNode(inner.nodes![0])!
    expect(created.componentId).toBe(ITEM)
    expect(created.parentId).toBe('inner')

    // The leaf's parent is untouched by a drop aimed elsewhere.
    expect(Aglyn.canvas.getNode('outer')!.nodes).toEqual(['leaf', 'inner'])
  })

  it('reparents a dragged node onto a leaf as a sibling, not a child', () => {
    const dnd = new DndManager()
    dnd.setDragNode(Aglyn.canvas.getNode('inner'))
    dnd.setDropNode(Aglyn.canvas.getNode('leaf'))
    dnd.setDropRegion(DropRegion.CHILDREN)
    dnd.onDragEnd()

    // Without the fix `inner` would nest inside the leaf; instead it stays a
    // sibling under the shared parent.
    expect(Aglyn.canvas.getNode('leaf')!.nodes).toEqual([])
    expect(Aglyn.canvas.getNode('inner')!.parentId).toBe('outer')
    expect(Aglyn.canvas.getNode('outer')!.nodes).toEqual(['leaf', 'inner'])
  })

  describe('computedDrop', () => {
    it('resolves a leaf CHILDREN drop against the leaf parent', () => {
      const dnd = new DndManager()
      dnd.setDragNode(presetOf())
      dnd.setDropNode(Aglyn.canvas.getNode('leaf'))
      dnd.setDropRegion(DropRegion.CHILDREN)
      // The parent actor for lineal validation must be the leaf's parent, not
      // the leaf (which, declaring no restrictChildren, would wrongly pass).
      expect(dnd.computedDrop?.$id).toBe('outer')
    })

    it('keeps a container CHILDREN drop resolved against the container', () => {
      const dnd = new DndManager()
      dnd.setDragNode(presetOf())
      dnd.setDropNode(Aglyn.canvas.getNode('inner'))
      dnd.setDropRegion(DropRegion.CHILDREN)
      expect(dnd.computedDrop?.$id).toBe('inner')
    })
  })
})
