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
import _isArr from '@aglyn/shared-util-guards/_is-arr'
import _isObj from '@aglyn/shared-util-guards/_is-obj'
import cloneDeep from 'lodash-es/cloneDeep'
import { observable, toJS } from 'mobx'
import { NODE_ROOT_ID, NodeNavigationHierarchy } from '../../index'
import { getComponentLabel } from '../components-manager/components-manager'
import { AglynEvent, emitter } from '../emit-manager'
import {
  createNodeId,
  nodeFactory,
  type NodeId,
  type NodeSchema,
  type NodeSchemaNested,
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

export function createNode<P = JSX.AnyProps>(
  schema: PartialKeys<NodeSchema<P>, '$id'>,
): NodeSchema<P> {
  return nodeFactory({ ...schema, $id: schema?.$id ?? createNodeId() })
}

export function clearNodes() {
  for (const key in nodes) delete nodes[key]
}

export function setNodes<P = JSX.AnyProps>(
  values: Record<NodeId, NodeSchema<P>>,
) {
  Object.entries(values).forEach(([id, node]) => {
    nodes[id] = createNode(node)
  })
}

export function hasNode($id: NodeId): boolean {
  return Object.hasOwn(nodes, $id)
}

export function getNode<P = JSX.AnyProps>(
  $id: NodeId,
): NodeSchema<P> | undefined {
  return nodes[$id]
}

export function setNodeItem<P = JSX.AnyProps>(node: NodeSchema<P>) {
  nodes[node.$id] = createNode(node)
}

export function deleteNode<P = JSX.AnyProps>(node: NodeSchema<P>) {
  if (!node || node.$id === NODE_ROOT_ID) return
  deleteChildNodes(node)
  removeNodeFromParent(node, getNode(node.parentId))
  delete nodes[node.$id]
}

export function removeNodeFromParent(
  node: NodeSchema<any>,
  parent: NodeSchema<any>,
) {
  if (!node || !parent || !parent.nodes.some((id) => id === node.$id)) return
  parent.nodes = [...parent.nodes].filter((id) => id !== node.$id)
  nodes[parent.$id] = parent
  node.parentId = null
}

export function addNodeToParent(
  node: NodeSchema<any>,
  parent: NodeSchema<any>,
  index = NaN,
) {
  if (!node || !parent || parent.nodes.some((id) => id === node.$id)) return
  if (isNaN(index)) {
    parent.nodes = [...parent.nodes, node.$id]
  } else {
    parent.nodes.splice(index, 0, node.$id)
  }

  node.parentId = parent.$id
  nodes[parent.$id] = parent
  nodes[node.$id] = node
}

function deleteChildNodes<P = JSX.AnyProps>(node: NodeSchema<P>) {
  const children = Array.isArray(node.nodes) ? node.nodes : []
  for (const childId of children) {
    const child = getNode(childId)
    if (child) {
      deleteChildNodes(child)
      deleteNode(child)
    }
  }
}

export function duplicateNode<P = JSX.AnyProps>(
  node: NodeSchema<P>,
): NodeSchema<P> {
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
  index = NaN,
) {
  removeNodeFromParent(node, oldParent)
  addNodeToParent(node, newParent, index)
}

function duplicateNodeAndChildren<P = JSX.AnyProps>(
  node: NodeSchema<P>,
  parentId: NodeId,
): NodeSchema<P> {
  const copied = cloneDeep(node)
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

export function nestNodes(
  nodes: Record<NodeId, NodeSchema<any>>,
  rootNode: NodeSchema<any>,
): NodeSchemaNested<any> {
  const parent = cloneDeep(rootNode) as unknown as NodeSchemaNested<any>

  // TODO: Remove after migration to nodes property
  if (parent['elements']) {
    parent.nodes = parent['elements']
    delete parent['elements']
  }
  if (parent['bundleId']) {
    parent.pluginId = parent['bundleId']
    delete parent['bundleId']
  }

  parent.nodes = (parent.nodes ||= []).map((id) => {
    const child = nodes[id as unknown as string]
    return nestNodes(nodes, child)
  })

  return parent
}

export function denormalizeNodes(
  nodes: NodeSchemaNested<any>[],
  parentId: NodeId,
  accumulator: Record<NodeId, NodeSchema<any>> = {},
): Record<NodeId, NodeSchema<any>> {
  for (const nestedNode of nodes || []) {
    // TODO: Remove after migration to nodes property
    if (nestedNode['elements']) {
      nestedNode.nodes = nestedNode['elements']
      delete nestedNode['elements']
    }
    if (nestedNode['bundleId']) {
      nestedNode.pluginId = nestedNode['bundleId']
      delete nestedNode['bundleId']
    }

    const node = cloneDeep(nestedNode) as unknown as NodeSchema<any>

    node.parentId = parentId
    node.nodes = ((node as unknown as NodeSchemaNested<any>)?.nodes || []).map(
      (child) => child?.$id,
    )
    denormalizeNodes(nestedNode.nodes, node.$id, accumulator)
    accumulator[node.$id] = node
  }
  return accumulator
}

type ProcessableNodes =
  | NodeSchemaNested<any>[]
  | NodeSchemaNested<any>
  | Record<NodeId, NodeSchema>
export function processNodesToDenormalized(
  value: ProcessableNodes,
): Record<NodeId, NodeSchema<any>> {
  let response: Record<NodeId, NodeSchema<any>> = null

  if (Array.isArray(value)) {
    response = denormalizeNodes(
      [
        {
          $id: NODE_ROOT_ID,
          componentId: 'div',
          nodes: [...value],
        },
      ],
      null,
    )
  } else if (
    _isObj(value) &&
    Array.isArray(value?.nodes) &&
    typeof value.nodes[0] !== 'string'
  ) {
    const _value = { ...(value as NodeSchemaNested<any>) }
    response = denormalizeNodes([_value], _value.parentId || NODE_ROOT_ID)
  } else {
    response = value as unknown as Record<NodeId, NodeSchema>
  }

  return response
}

export function isRootNodeId(id: NodeId): id is typeof NODE_ROOT_ID {
  return id === NODE_ROOT_ID
}

export function isRootNode(node: NodeSchema): boolean {
  return node?.$id === NODE_ROOT_ID
}

export function getNodeNavigationHierarchy(
  nodeId: NodeId,
): NodeNavigationHierarchy
export function getNodeNavigationHierarchy(
  node: NodeSchema,
): NodeNavigationHierarchy
export function getNodeNavigationHierarchy(
  nodeOrId: NodeId | NodeSchema,
): NodeNavigationHierarchy {
  const hierarchy = [NODE_ROOT_ID]

  let currentId = typeof nodeOrId !== 'string' ? nodeOrId?.$id : nodeOrId
  while (currentId && !isRootNodeId(currentId)) {
    hierarchy.splice(1, 0, currentId)
    currentId = getNode(currentId)?.parentId
  }

  return hierarchy as NodeNavigationHierarchy
}

export function getNodeLabelShort(node: NodeSchema) {
  if (isRootNode(node)) return 'Document'
  const componentLabel = getComponentLabel(node?.componentId)
  return node?.displayName || componentLabel || node?.$id
}
