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
import { createNodeId, nodeFactory, type NodeId, type NodeSchema } from './node'

export * from './node'

export const nodes: Record<NodeId, NodeSchema<any>> = {}

export function getNode<P>($id: NodeId): NodeSchema<P> | undefined {
  return nodes[$id]
}

export function setNode<P>(node: NodeSchema<P>) {
  nodes[node.$id] = node
}

export function createNode<P>(
  schema: PartialKeys<NodeSchema<P>, '$id'>,
): NodeSchema<P> {
  return nodeFactory({ ...schema, $id: schema?.$id ?? createNodeId() })
}

export function deleteChildNodes<P>(node: NodeSchema<P>) {
  const children = Array.isArray(node.nodes) ? node.nodes : []
  for (const childId of children) {
    const child = getNode(childId)
    if (child) {
      deleteChildNodes(child)
      deleteNode(child)
    }
  }
}

export function deleteNode<P>(node: NodeSchema<P>) {
  deleteChildNodes(node)
  delete nodes[node.$id]
}

/** @ignore */
export function duplicateNodeAndChildren<P>(
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
  setNode(newNode)
  return newNode as NodeSchema<P>
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
