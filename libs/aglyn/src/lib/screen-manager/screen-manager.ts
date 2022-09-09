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

import type { PartialKeys } from '@aglyn/shared-data-types'
import { _isArr } from '@aglyn/shared-util-guards'
import { copy } from '@aglyn/shared-util-tools'
import { observable, toJS } from 'mobx'
import { AglynEvent, emitter } from '../emit-manager'
import {
  createNodeId,
  nodeFactory,
  type NodeId,
  type NodeSchema,
  NodeSchemaDenormalized,
} from './node'

export * from './node'

export const nodes: Record<NodeId, NodeSchema<any>> = observable({})

emitter.on(AglynEvent.NODE_CLEAR_ITEMS, () => {
  clearNodes()
})
emitter.on(AglynEvent.NODE_SET_ITEMS, ({ nodes }) => {
  setNodes(nodes)
})
emitter.on(AglynEvent.NODE_SET, ({ node }) => {
  setNodeItem(node)
})
emitter.on(AglynEvent.NODE_DELETE, ({ node }) => {
  deleteNode(node)
})
emitter.on(AglynEvent.NODE_DUPLICATE, ({ node }) => {
  duplicateNode(node)
})
emitter.on(
  AglynEvent.NODE_REPARENT,
  ({ node, oldParent, newParent, index }) => {
    reparentNode(node, oldParent, newParent, index)
  },
)

export function toJSON() {
  return {
    nodes: toJS(nodes),
  }
}

export function createNode<P>(
  schema: PartialKeys<NodeSchema<P>, '$id'>,
): NodeSchema<P> {
  return nodeFactory({ ...schema, $id: schema?.$id ?? createNodeId() })
}

export function clearNodes() {
  for (const key in nodes) delete nodes[key]
}

export function setNodes<P>(values: Record<NodeId, NodeSchema<P>>) {
  Object.entries(values).forEach(([id, node]) => {
    nodes[id] = createNode(node)
  })
}

export function getNode<P>($id: NodeId): NodeSchema<P> | undefined {
  return nodes[$id]
}

export function setNodeItem<P>(node: NodeSchema<P>) {
  nodes[node.$id] = createNode(node)
}

export function deleteNode<P>(node: NodeSchema<P>) {
  deleteChildNodes(node)
  delete nodes[node.$id]
}

export function duplicateNode<P>(node: NodeSchema<P>): NodeSchema<P> {
  const parentId = node.parentId
  const parent = nodes[parentId]
  const oldIndex = parent.nodes.indexOf(node.$id)
  const newNode = duplicateNodeAndChildren(node, parentId)
  parent.nodes.splice(oldIndex + 1, 0, newNode.$id)
  return newNode
}

export function reparentNode(
  node: NodeSchema<any>,
  oldParent: NodeSchema<any>,
  newParent: NodeSchema<any>,
  index: number,
) {
  oldParent.nodes = oldParent.nodes.filter((id) => id !== node.$id)
  node.parentId = newParent.$id
  if (isNaN(index)) newParent.nodes.push(node.$id)
  else newParent.nodes.splice(index, 0, node.$id)

  nodes[oldParent.$id] = oldParent
  nodes[newParent.$id] = newParent
  nodes[node.$id] = node
}

function deleteChildNodes<P>(node: NodeSchema<P>) {
  const children = Array.isArray(node.nodes) ? node.nodes : []
  for (const childId of children) {
    const child = getNode(childId)
    if (child) {
      deleteChildNodes(child)
      deleteNode(child)
    }
  }
}

function duplicateNodeAndChildren<P>(
  node: NodeSchema<P>,
  parentId: NodeId,
): NodeSchema<P> {
  const copied = copy(node)
  const newNode = createNode({
    ...copied,
    $id: createNodeId(),
    parentId: parentId,
    nodes: [],
  })
  for (const childId of _isArr(node.nodes) ? node.nodes : []) {
    const oldChild = getNode(childId)
    if (oldChild) {
      const newChild = duplicateNodeAndChildren(oldChild, newNode.$id)
      newNode.nodes.push(newChild.$id)
    }
  }
  setNodeItem(newNode)
  return newNode as NodeSchema<P>
}

export function denormalizeNodes(
  nodes: Record<NodeId, NodeSchema<any>>,
  rootNode: NodeSchema<any>,
) {
  const parent = copy(rootNode) as unknown as NodeSchemaDenormalized<any>

  parent.nodes = (parent.nodes ||= []).map((id) => {
    const child = nodes[id as unknown as string]
    child.parentId = parent.$id
    return denormalizeNodes(nodes, child)
  })

  return parent
}

export function normalizeNodes(
  nodes: NodeSchemaDenormalized<any>[],
  accumulator: Record<NodeId, NodeSchema<any>> = {},
) {
  for (const rootNode of nodes) {
    const parent = copy(rootNode) as unknown as NodeSchema<any>
    parent.nodes = (parent as unknown as NodeSchemaDenormalized<any>).nodes.map(
      (child) => child.$id,
    )
    accumulator = {
      ...accumulator,
      ...normalizeNodes(rootNode.nodes, accumulator),
    }
    accumulator[parent.$id] = parent
  }
  return accumulator
}
