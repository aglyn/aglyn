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
})
