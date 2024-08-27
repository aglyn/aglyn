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
      parentId: null,
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
      parentId: null,
      componentId: 'div',
      props: {},
      sx: {},
      nodes: [
        {
          $id: 'child1',
          parentId: NODE_ROOT_ID,
          componentId: 'div',
          props: {},
          sx: {},
          nodes: [
            {
              $id: 'child1-1',
              parentId: 'child1',
              componentId: 'div',
              props: {},
              sx: {},
              nodes: [],
            },
            {
              $id: 'child1-2',
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
})
