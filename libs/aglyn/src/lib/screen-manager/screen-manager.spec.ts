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

import { CANVAS_ROOT_ELEMENT_ID } from '../constants'
import {
  denormalizeNodes,
  NodeId,
  NodeSchema,
  NodeSchemaDenormalized,
  normalizeNodes,
} from './screen-manager'

describe('Aglyn: Screen Manager', () => {
  const nodes: Record<NodeId, NodeSchema> = {
    [CANVAS_ROOT_ELEMENT_ID]: {
      $id: CANVAS_ROOT_ELEMENT_ID,
      parentId: null,
      componentId: 'div',
      props: {},
      sx: {},
      nodes: ['child1', 'child2'],
    },
    child1: {
      $id: 'child1',
      parentId: CANVAS_ROOT_ELEMENT_ID,
      componentId: 'div',
      props: {},
      sx: {},
      nodes: ['child1-1', 'child1-2'],
    },
    child2: {
      $id: 'child2',
      parentId: CANVAS_ROOT_ELEMENT_ID,
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

  const denormalized: NodeSchemaDenormalized[] = [
    {
      $id: CANVAS_ROOT_ELEMENT_ID,
      parentId: null,
      componentId: 'div',
      props: {},
      sx: {},
      nodes: [
        {
          $id: 'child1',
          parentId: CANVAS_ROOT_ELEMENT_ID,
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
          parentId: CANVAS_ROOT_ELEMENT_ID,
          componentId: 'div',
          props: {},
          sx: {},
          nodes: [],
        },
      ],
    },
  ]

  it('Denormalize Nodes', () => {
    const denormal = denormalizeNodes(nodes, nodes[CANVAS_ROOT_ELEMENT_ID])
    expect(denormal).toEqual(denormalized[0])
  })

  it('Normalize Nodes', () => {
    const normal = normalizeNodes(denormalized)
    expect(normal).toEqual(nodes)
  })

  it('Normalize Nodes then Denormalize', () => {
    const normal = normalizeNodes(denormalized)
    const denormal = denormalizeNodes(normal, normal[CANVAS_ROOT_ELEMENT_ID])
    expect(denormal).toEqual(denormalized[0])
  })

  it('Denormalize Nodes then Normalize', () => {
    const denormal = denormalizeNodes(nodes, nodes[CANVAS_ROOT_ELEMENT_ID])
    const normal = normalizeNodes([denormal])
    expect(normal).toEqual(nodes)
  })

  it('Denormalize Nodes then Normalize then Denormalize again', () => {
    const denormal = denormalizeNodes(nodes, nodes[CANVAS_ROOT_ELEMENT_ID])
    const normal = normalizeNodes([denormal])
    const denormal2 = denormalizeNodes(normal, normal[CANVAS_ROOT_ELEMENT_ID])
    expect(denormal2).toEqual(denormalized[0])
  })

  it('Normalize Nodes then Denormalize then Normalize again', () => {
    const normal = normalizeNodes(denormalized)
    const denormal = denormalizeNodes(normal, normal[CANVAS_ROOT_ELEMENT_ID])
    const normal2 = normalizeNodes([denormal])
    expect(normal2).toEqual(nodes)
  })
})
