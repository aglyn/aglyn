/**
 * @license
 * Copyright 2024 Aglyn LLC
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

import { NodeId, NodeSchema, NodeSchemaNested, NodeType } from '../types/nodes'
import { FEATURE_FLAG } from '../foundation'
import { CanvasManager, NODE_ROOT_ID } from './canvas-manager'

describe('Aglyn: Screen Manager', () => {
  const nodes: Record<NodeId, NodeSchema> = {
    [NODE_ROOT_ID]: {
      $id: NODE_ROOT_ID,
      type: NodeType.NODE,
      parentId: NODE_ROOT_ID,
      componentId: 'div',
      props: {},
      sx: {},
      nodes: ['child1', 'child2'],
    },
    child1: {
      $id: 'child1',
      type: NodeType.NODE,
      parentId: NODE_ROOT_ID,
      componentId: 'div',
      props: {},
      sx: {},
      nodes: ['child1-1', 'child1-2'],
    },
    child2: {
      $id: 'child2',
      type: NodeType.NODE,
      parentId: NODE_ROOT_ID,
      componentId: 'div',
      props: {},
      sx: {},
      nodes: [],
    },
    'child1-1': {
      $id: 'child1-1',
      type: NodeType.NODE,
      parentId: 'child1',
      componentId: 'div',
      props: {},
      sx: {},
      nodes: [],
    },
    'child1-2': {
      $id: 'child1-2',
      type: NodeType.NODE,
      parentId: 'child1',
      componentId: 'div',
      props: {},
      sx: {},
      nodes: [],
    },
  }

  const denormalized: NodeSchemaNested[] = [
    {
      $id: NODE_ROOT_ID,
      type: NodeType.NODE,
      parentId: NODE_ROOT_ID,
      componentId: 'div',
      props: {},
      sx: {},
      nodes: [
        {
          $id: 'child1',
          type: NodeType.NODE,
          parentId: NODE_ROOT_ID,
          componentId: 'div',
          props: {},
          sx: {},
          nodes: [
            {
              $id: 'child1-1',
              type: NodeType.NODE,
              parentId: 'child1',
              componentId: 'div',
              props: {},
              sx: {},
              nodes: [],
            },
            {
              $id: 'child1-2',
              type: NodeType.NODE,
              parentId: 'child1',
              componentId: 'div',
              props: {},
              sx: {},
              nodes: [],
            },
          ],
        },
        {
          $id: 'child2',
          type: NodeType.NODE,
          parentId: NODE_ROOT_ID,
          componentId: 'div',
          props: {},
          sx: {},
          nodes: [],
        },
      ],
    },
  ]

  it('Denormalize Nodes', () => {
    const denormal = CanvasManager.nestDenormalizedNodes(nodes, NODE_ROOT_ID)
    expect(denormal).toEqual(denormalized[0])
  })

  it('Normalize Nodes', () => {
    const normal = CanvasManager.denormalizeNodes(denormalized, NODE_ROOT_ID)
    expect(normal).toEqual(nodes)
  })

  it('Normalize Nodes then Denormalize', () => {
    const normal = CanvasManager.denormalizeNodes(denormalized, NODE_ROOT_ID)
    const denormal = CanvasManager.nestDenormalizedNodes(normal, NODE_ROOT_ID)
    expect(denormal).toEqual(denormalized[0])
  })

  it('Denormalize Nodes then Normalize', () => {
    const denormal = CanvasManager.nestDenormalizedNodes(nodes, NODE_ROOT_ID)
    const normal = CanvasManager.denormalizeNodes([denormal], NODE_ROOT_ID)
    expect(normal).toEqual(nodes)
  })

  it('Denormalize Nodes then Normalize then Denormalize again', () => {
    const denormal = CanvasManager.nestDenormalizedNodes(nodes, NODE_ROOT_ID)
    const normal = CanvasManager.denormalizeNodes([denormal], NODE_ROOT_ID)
    const denormal2 = CanvasManager.nestDenormalizedNodes(normal, NODE_ROOT_ID)
    expect(denormal2).toEqual(denormalized[0])
  })

  it('Normalize Nodes then Denormalize then Normalize again', () => {
    const normal = CanvasManager.denormalizeNodes(denormalized, NODE_ROOT_ID)
    const denormal = CanvasManager.nestDenormalizedNodes(normal, NODE_ROOT_ID)
    const normal2 = CanvasManager.denormalizeNodes([denormal], NODE_ROOT_ID)
    expect(normal2).toEqual(nodes)
  })

  describe('setNodes id coercion', () => {
    it('trusts the map key for missing ids and pins the root to the canonical id', () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes({
        [NODE_ROOT_ID]: { nodes: ['child'] },
        child: { parentId: NODE_ROOT_ID },
        stale: { $id: 'stale', parentId: NODE_ROOT_ID },
      } as any)
      expect(canvas.getNode(NODE_ROOT_ID)?.$id).toBe(NODE_ROOT_ID)
      expect(canvas.getNode('child')?.$id).toBe('child')
      expect(canvas.getNode('stale')?.$id).toBe('stale')
    })

    it('pins a root whose persisted id drifted from the key', () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes({
        [NODE_ROOT_ID]: { $id: 'ke5jYbh8mw', nodes: [] },
      } as any)
      expect(canvas.getNode(NODE_ROOT_ID)?.$id).toBe(NODE_ROOT_ID)
    })
  })

  describe('initial-state tracking', () => {
    const makeCanvas = () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(nodes)
      return canvas
    }

    it('reports the state as current before any remote snapshot is recorded', () => {
      const canvas = new CanvasManager(undefined as any)
      expect(canvas.isInitialSame).toBe(true)
      canvas.setNodes(nodes)
      expect(canvas.isInitialSame).toBe(true)
      expect(canvas.didSetInitial).toBe(false)
    })

    it('detects divergence from the recorded snapshot and recovery on undo', () => {
      const canvas = makeCanvas()
      canvas.updateInitialNodes()
      expect(canvas.isInitialSame).toBe(true)

      const child = canvas.nodes.get('child1')
      canvas.updateNodeProps(child, { title: 'changed' })
      expect(canvas.isInitialSame).toBe(false)

      canvas.undo()
      expect(canvas.isInitialSame).toBe(true)
    })

    it('treats the state as current after recording the serialized form used for saving', () => {
      const canvas = makeCanvas()
      canvas.updateInitialNodes()
      const child = canvas.nodes.get('child2')
      canvas.updateNodeProps(child, { title: 'saved' })
      expect(canvas.isInitialSame).toBe(false)

      canvas.updateInitialNodes(canvas.toJSON().nodes)
      expect(canvas.isInitialSame).toBe(true)
    })
  })

  describe('nestedNodes raw json', () => {
    it('embeds full children through JSON.stringify instead of id refs', () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(nodes)

      const raw = JSON.parse(JSON.stringify(canvas.nestedNodes))

      expect(raw.$id).toBe(NODE_ROOT_ID)
      expect(raw.nodes).toHaveLength(2)
      expect(raw.nodes[0].$id).toBe('child1')
      expect(raw.nodes[1].$id).toBe('child2')
      expect(raw.nodes[0].nodes[0].$id).toBe('child1-1')
      expect(raw.nodes[0].nodes[1].$id).toBe('child1-2')
    })

    it('round-trips the nested raw json back into the flat node map', () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(nodes)

      const raw = JSON.parse(JSON.stringify(canvas.nestedNodes))
      const denormalized = canvas.processNodesToDenormalized(raw)

      expect(Object.keys(denormalized).sort()).toEqual(
        Object.keys(nodes).sort(),
      )
      expect(denormalized['child1'].nodes).toEqual(['child1-1', 'child1-2'])
    })
  })

  describe('addNodeFromPreset (AGL-537)', () => {
    const makeCanvas = () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(nodes)
      return canvas
    }

    const makePreset = (componentId: string, children: string[] = []) =>
      ({
        $id: `preset-${componentId}`,
        type: NodeType.PRESET,
        data: {
          $id: 'seed',
          type: NodeType.NODE,
          componentId,
          pluginId: 'test-plugin',
          props: {},
          sx: {},
          nodes: children.map((childComponentId, i) => ({
            $id: `seed-child-${i}`,
            type: NodeType.NODE,
            componentId: childComponentId,
            pluginId: 'test-plugin',
            props: {},
            sx: {},
            nodes: [] as NodeSchemaNested[],
          })),
        },
      }) as any

    /** Node ids present in the map but referenced by no parent's `nodes`. */
    const collectOrphans = (canvas: CanvasManager): NodeId[] => {
      const referenced = new Set<NodeId>([NODE_ROOT_ID])
      for (const node of canvas.nodes.values()) {
        for (const id of node.nodes ?? []) referenced.add(id)
      }
      return [...canvas.nodes.keys()].filter((id) => !referenced.has(id))
    }

    it('creates the node and appends it to the root in the same update', () => {
      const canvas = makeCanvas()
      const root = canvas.getNode(NODE_ROOT_ID)!

      const node = canvas.addNodeFromPreset(makePreset('appbar'), root)

      expect(node).toBeTruthy()
      expect(node.parentId).toBe(NODE_ROOT_ID)
      expect(canvas.getNode(NODE_ROOT_ID)!.nodes).toContain(node.$id)
      expect(collectOrphans(canvas)).toEqual([])
    })

    it('inserts into a selected container and registers preset children', () => {
      const canvas = makeCanvas()
      const container = canvas.getNode('child2')!

      const node = canvas.addNodeFromPreset(
        makePreset('appbar', ['toolbar']),
        container,
      )

      expect(node.parentId).toBe('child2')
      expect(canvas.getNode('child2')!.nodes).toContain(node.$id)
      // The preset's default child is grafted and attached too.
      expect(node.nodes).toHaveLength(1)
      expect(canvas.getNode(node.nodes![0])?.parentId).toBe(node.$id)
      // The root only ever gained its original children.
      expect(canvas.getNode(NODE_ROOT_ID)!.nodes).toEqual([
        'child1',
        'child2',
      ])
      expect(collectOrphans(canvas)).toEqual([])
    })

    it('resolves a stale parent reference to the live canvas node', () => {
      const canvas = makeCanvas()
      // A detached copy that only shares the id with the live node — e.g. a
      // node object retained across a canvas reload.
      const stale = { $id: 'child2' } as any

      const node = canvas.addNodeFromPreset(makePreset('appbar'), stale)

      expect(canvas.getNode('child2')!.nodes).toContain(node.$id)
      expect(stale.nodes).toBeUndefined()
      expect(collectOrphans(canvas)).toEqual([])
    })

    it('refuses a parent that is not a live canvas node instead of orphaning', () => {
      const canvas = makeCanvas()
      const before = canvas.nodes.size
      // The shape of the historical bug: a menu click event handed in as
      // the parent (truthy, but not a node).
      const clickEvent = { type: 'click', currentTarget: {} } as any

      expect(() =>
        canvas.addNodeFromPreset(makePreset('appbar'), clickEvent),
      ).toThrow('Invalid parent node')

      expect(canvas.nodes.size).toBe(before)
      expect('nodes' in clickEvent).toBe(false)
      expect(collectOrphans(canvas)).toEqual([])
    })
  })

  describe('applyNodes history', () => {
    it('makes a raw-json replacement undoable and redoable', () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(nodes)
      expect(canvas.canUndo).toBe(false)

      const edited = JSON.parse(JSON.stringify(canvas.nestedNodes))
      edited.nodes[0].props = { title: 'edited via raw json' }
      canvas.applyNodes(edited)

      expect(canvas.canUndo).toBe(true)
      expect(canvas.nodes.get('child1').props).toEqual({
        title: 'edited via raw json',
      })

      canvas.undo()
      expect(canvas.nodes.get('child1').props).toEqual({})
      expect(canvas.canRedo).toBe(true)

      canvas.redo()
      expect(canvas.nodes.get('child1').props).toEqual({
        title: 'edited via raw json',
      })
    })

    it('clears the redo stack when a new raw-json edit is applied', () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(nodes)

      const first = JSON.parse(JSON.stringify(canvas.nestedNodes))
      first.nodes[0].props = { title: 'first' }
      canvas.applyNodes(first)
      canvas.undo()
      expect(canvas.canRedo).toBe(true)

      const second = JSON.parse(JSON.stringify(canvas.nestedNodes))
      second.nodes[1].props = { title: 'second' }
      canvas.applyNodes(second)
      expect(canvas.canRedo).toBe(false)
      expect(canvas.canUndo).toBe(true)
    })
  })

  // Insert-target resolution (AGL-575): the Insert menu hands the current
  // selection in as the target. Containers accept the node as a child; a
  // leaf (no children slot) redirects to its container as the next sibling.
  describe('resolveInsertTarget / nodeAcceptsChildren (AGL-575)', () => {
    const CONTAINER = 'testContainer575'
    const LEAF_TEXT = 'testLeafText575'
    const LEAF_SELF = 'testLeafSelf575'
    const UNKNOWN = 'testUnregistered575'
    const schemas: Record<string, any> = {
      div: {},
      [CONTAINER]: {},
      [LEAF_TEXT]: { flags: { textEditable: FEATURE_FLAG.ENABLED } },
      [LEAF_SELF]: { flags: { selfClosing: FEATURE_FLAG.ENABLED } },
    }
    const fakeAglyn = {
      components: { getSchema: (id: string) => schemas[id] },
    } as any

    const makeCanvas = () => {
      const canvas = new CanvasManager(fakeAglyn)
      canvas.setNodes({
        [NODE_ROOT_ID]: {
          $id: NODE_ROOT_ID,
          type: NodeType.NODE,
          parentId: NODE_ROOT_ID,
          componentId: 'div',
          props: {},
          sx: {},
          nodes: ['stack'],
        },
        stack: {
          $id: 'stack',
          type: NodeType.NODE,
          parentId: NODE_ROOT_ID,
          componentId: CONTAINER,
          props: {},
          sx: {},
          nodes: ['a', 'b', 'c'],
        },
        a: {
          $id: 'a',
          type: NodeType.NODE,
          parentId: 'stack',
          componentId: LEAF_TEXT,
          props: {},
          sx: {},
          nodes: [],
        },
        b: {
          $id: 'b',
          type: NodeType.NODE,
          parentId: 'stack',
          componentId: LEAF_SELF,
          props: {},
          sx: {},
          nodes: [],
        },
        c: {
          $id: 'c',
          type: NodeType.NODE,
          parentId: 'stack',
          componentId: UNKNOWN,
          props: {},
          sx: {},
          nodes: [],
        },
      })
      return canvas
    }

    it('nodeAcceptsChildren: root and containers do, leaves do not', () => {
      const canvas = makeCanvas()
      expect(canvas.nodeAcceptsChildren(canvas.getNode(NODE_ROOT_ID)!)).toBe(
        true,
      )
      expect(canvas.nodeAcceptsChildren(canvas.getNode('stack')!)).toBe(true)
      expect(canvas.nodeAcceptsChildren(canvas.getNode('a')!)).toBe(false)
      expect(canvas.nodeAcceptsChildren(canvas.getNode('b')!)).toBe(false)
      // Unregistered components default to accepting children.
      expect(canvas.nodeAcceptsChildren(canvas.getNode('c')!)).toBe(true)
    })

    it('resolveInsertTarget: a container appends as a child (NaN index)', () => {
      const canvas = makeCanvas()
      const { parent, index } = canvas.resolveInsertTarget(
        canvas.getNode('stack'),
      )
      expect(parent.$id).toBe('stack')
      expect(Number.isNaN(index)).toBe(true)
    })

    it('resolveInsertTarget: a leaf redirects to its container as next sibling', () => {
      const canvas = makeCanvas()
      expect(canvas.resolveInsertTarget(canvas.getNode('a'))).toMatchObject({
        index: 1,
      })
      expect(canvas.resolveInsertTarget(canvas.getNode('a')).parent.$id).toBe(
        'stack',
      )
      // Self-closing leaf, second position → next sibling at index 2.
      expect(canvas.resolveInsertTarget(canvas.getNode('b')).index).toBe(2)
    })

    it('resolveInsertTarget: falls back to the root for a missing/non-node target', () => {
      const canvas = makeCanvas()
      const fallback = canvas.resolveInsertTarget(undefined)
      expect(fallback.parent.$id).toBe(NODE_ROOT_ID)
      expect(Number.isNaN(fallback.index)).toBe(true)

      const stale = canvas.resolveInsertTarget({ $id: 'ghost' } as any)
      expect(stale.parent.$id).toBe(NODE_ROOT_ID)
    })
  })
})
