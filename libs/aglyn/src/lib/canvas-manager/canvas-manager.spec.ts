/**
 * @license
 * Copyright 2022 Aglyn LLC
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
  denormalizeNodes,
  nestNodes,
  NODE_ROOT_ID,
  NodeId,
  NodeSchema,
  NodeSchemaNested,
} from './canvas-manager'

describe('Aglyn: Screen Manager', () => {
  const nodes: Record<NodeId, NodeSchema> = {
    [NODE_ROOT_ID]: {
      $id: NODE_ROOT_ID,
      parentId: null,
      componentId: 'div',
      props: {},
      sx: {},
      nodes: ['child1', 'child2'],
    },
    child1: {
      $id: 'child1',
      parentId: NODE_ROOT_ID,
      componentId: 'div',
      props: {},
      sx: {},
      nodes: ['child1-1', 'child1-2'],
    },
    child2: {
      $id: 'child2',
      parentId: NODE_ROOT_ID,
      componentId: 'div',
      props: {},
      sx: {},
      nodes: [],
    },
    'child1-1': {
      $id: 'child1-1',
      parentId: 'child1',
      componentId: 'div',
      props: {},
      sx: {},
      nodes: [],
    },
    'child1-2': {
      $id: 'child1-2',
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
    const denormal = nestNodes(nodes, nodes[NODE_ROOT_ID])
    expect(denormal).toEqual(denormalized[0])
  })

  it('Normalize Nodes', () => {
    const normal = denormalizeNodes(denormalized, NODE_ROOT_ID)
    expect(normal).toEqual(nodes)
  })

  it('Normalize Nodes then Denormalize', () => {
    const normal = denormalizeNodes(denormalized, NODE_ROOT_ID)
    const denormal = nestNodes(normal, normal[NODE_ROOT_ID])
    expect(denormal).toEqual(denormalized[0])
  })

  it('Denormalize Nodes then Normalize', () => {
    const denormal = nestNodes(nodes, nodes[NODE_ROOT_ID])
    const normal = denormalizeNodes([denormal], NODE_ROOT_ID)
    expect(normal).toEqual(nodes)
  })

  it('Denormalize Nodes then Normalize then Denormalize again', () => {
    const denormal = nestNodes(nodes, nodes[NODE_ROOT_ID])
    const normal = denormalizeNodes([denormal], NODE_ROOT_ID)
    const denormal2 = nestNodes(normal, normal[NODE_ROOT_ID])
    expect(denormal2).toEqual(denormalized[0])
  })

  it('Normalize Nodes then Denormalize then Normalize again', () => {
    const normal = denormalizeNodes(denormalized, NODE_ROOT_ID)
    const denormal = nestNodes(normal, normal[NODE_ROOT_ID])
    const normal2 = denormalizeNodes([denormal], NODE_ROOT_ID)
    expect(normal2).toEqual(nodes)
  })
})
