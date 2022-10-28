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
import _isStrT from '@aglyn/shared-util-guards/_is-str-t'
import cloneDeep from 'lodash-es/cloneDeep'
import { observable, runInAction, toJS } from 'mobx'
import {
  type ComponentSchema,
  getComponentLabel,
  getSchema,
} from '../components-manager/components-manager'
import { createIdUrlSafe } from '../constants'
import { AglynEvent, emitter } from '../emit-manager'
import type { PluginId } from '../plugin-manager'

export const nodes: Record<NodeId, NodeSchema<any>> = observable({})
export const NODE_ROOT_ID = '_@_'
export const NODE_ID_LENGTH = 10
export const NODE_ROOT_LABEL = 'Document'

export enum NType {
  NODE = 'node',
  TEXT = 'text',
  SCREEN = 'screen',
  REF = 'ref',
}

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

export type NodeId = string

export interface NodeModel<TYPE extends NType = null> {
  /**
   * The unique identifier for a node
   */
  $id: NodeId
  /**
   * Display name of node to override inherited label. Only used in editor
   */
  name?: string
  /**
   * The node type to describe the IST
   */
  type?: TYPE
}

export interface NodeSchema<P = JSX.AnyProps> extends NodeModel<NType.NODE> {
  /**
   * The unique identifier of the node component
   */
  componentId: string
  /**
   * The unique identifier of the node component plugin bundle
   */
  pluginId?: PluginId
  /**
   * The unique identifier of the node parent
   */
  parentId?: NodeId
  /**
   * List of the children unique identifiers for the node
   */
  nodes?: NodeId[]
  /**
   * Class name to pass the DOM node, can also be defined in props
   */
  className?: string
  /**
   * The node props/attributes passed to the component
   */
  props?: P
  /**
   * The node style properties for emotion
   */
  sx?: JSX.SxProps
  /**
   * The computed node parent (only for type completion)
   */
  parent?: NodeSchema<any> | null
  /**
   * The computed index in parent nodes (only for type completion)
   */
  index?: number | null
  /**
   * The computed label (only for type completion)
   */
  labelShort?: string | undefined
  /**
   * The computed breadcrumb path (only for type completion)
   */
  breadcrumbPath?: NodeBreadcrumbPath
  /**
   * The computed component schema (only for type completion)
   */
  componentSchema?: ComponentSchema | undefined
  /**
   * The computed guard for of child nodes (only for type completion)
   */
  hasNodes?: boolean
}

export type NodeSchemaNested<P = JSX.AnyProps> = Omit<
  NodeSchema<P>,
  'nodes'
> & { nodes?: NodeSchemaNested<any>[] }

export type NodeSchemaJSON<P = JSX.AnyProps> = Omit<
  NodeSchema<P>,
  | 'parent'
  | 'index'
  | 'labelShort'
  | 'breadcrumbPath'
  | 'componentSchema'
  | 'hasNodes'
>

export type NodeBreadcrumbPath = [
  root: string & typeof NODE_ROOT_ID,
  ...nodes: [...ancestors: NodeId[], node: NodeId],
]

export function createNodeId(): NodeId {
  return createIdUrlSafe(NODE_ID_LENGTH)
}

export function isRootNodeId(id: NodeId): id is typeof NODE_ROOT_ID {
  return id === NODE_ROOT_ID
}

export function nodeFactory<P = JSX.AnyProps>(
  schema: NodeSchema<P>,
): NodeSchema<P> {
  return observable({
    $id: schema.$id,
    componentId: schema.componentId,
    pluginId: schema.pluginId,
    parentId: schema.parentId,
    props: { ...schema.props },
    sx: Array.isArray(schema.sx) ? [...schema.sx] : { ...schema.sx },
    nodes: Array.isArray(schema.nodes) ? [...schema.nodes] : [],

    get parent(): NodeSchema<any> | null {
      return getNode(this.parentId)
    },
    get index(): number | null {
      return getNodeIndex(this)
    },
    get labelShort(): string {
      return getNodeLabelShort(this)
    },
    get breadcrumbPath(): NodeBreadcrumbPath {
      return getNodeBreadcrumbPath(this)
    },
    get componentSchema(): ComponentSchema | undefined {
      return getNodeComponentSchema(this)
    },
    get hasNodes(): boolean {
      return Array.isArray(this.nodes) && this.nodes.length > 0
    },
    toJSON(): NodeSchemaJSON<P> {
      return nodeToJSON(this)
    },
  })
}

export function isRootNode(node: NodeSchema): boolean {
  return node?.$id === NODE_ROOT_ID
}

export function toJSON() {
  return {
    nodes: toJS(nodes),
  }
}

export function nodeToJSON<P = JSX.AnyProps>(
  node: NodeSchema<P>,
): NodeSchemaJSON<P> {
  return toJS(node)
}

export function createNode<P = JSX.AnyProps>(
  schema: PartialKeys<NodeSchema<P>, '$id'>,
): NodeSchema<P> {
  return nodeFactory({ ...schema, $id: schema?.$id ?? createNodeId() })
}

export function clearNodes() {
  runInAction(() => {
    for (const key in nodes) delete nodes[key]
  })
}

export function setNodes<P = JSX.AnyProps>(
  values: Record<NodeId, NodeSchema<P>>,
) {
  runInAction(() => {
    Object.entries(values).forEach(([id, node]) => {
      nodes[id] = createNode(node)
    })
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

export function getNodeIndex(node: NodeSchema<any>) {
  const parent = getNode(node?.parentId)
  return parent?.nodes?.indexOf(node.$id)
}

export function isNodeFirstIndex(node: NodeSchema<any>) {
  return getNodeIndex(node) === 0
}

export function isNodeLastIndex(node: NodeSchema<any>) {
  const parent = getNode(node?.parentId)
  return getNodeIndex(node) + 1 === parent?.nodes?.length
}

export function getNodeComponentSchema(node: NodeSchema<any>): ComponentSchema {
  return getSchema(node?.componentId)
}

export function setNodeItem<P = JSX.AnyProps>(node: NodeSchema<P>) {
  runInAction(() => {
    nodes[node.$id] = createNode(node)
  })
}

export function deleteNode<P = JSX.AnyProps>(node: NodeSchema<P>) {
  if (!node || node.$id === NODE_ROOT_ID) return
  runInAction(() => {
    deleteChildNodes(node)
    removeNodeFromParent(node, getNode(node.parentId))
    delete nodes[node.$id]
  })
}

export function removeNodeFromParent(
  node: NodeSchema<any>,
  parent: NodeSchema<any>,
) {
  if (!node || !parent || !parent.nodes.some((id) => id === node.$id)) return

  runInAction(() => {
    parent.nodes = [...parent.nodes].filter((id) => id !== node.$id)
    nodes[parent.$id] = parent
    node.parentId = null
  })
}

export function addNodeToParent(
  node: NodeSchema<any>,
  parent: NodeSchema<any>,
  index = NaN,
) {
  if (!node || !parent || parent.nodes.some((id) => id === node.$id)) return
  runInAction(() => {
    if (isNaN(index)) {
      parent.nodes = [...parent.nodes, node.$id]
    } else {
      parent.nodes.splice(index, 0, node.$id)
    }

    node.parentId = parent.$id
    nodes[parent.$id] = parent
    nodes[node.$id] = node
  })
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
  const copied = nodeToJSON(node)
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
  for (const childNode of Array.isArray(nodes) ? nodes : []) {
    const child =
      _isStrT(childNode) && accumulator[childNode]
        ? accumulator[childNode]
        : childNode
    if (!_isObj(child)) continue

    const node = cloneDeep(child) as unknown as NodeSchema<any>

    // TODO: Remove after migration to nodes property
    if (node['elements']) {
      node.nodes = node['elements']
      delete node['elements']
    }
    // TODO: Remove after migration to pluginId property
    if (node['bundleId']) {
      node.pluginId = node['bundleId']
      delete node['bundleId']
    }

    const nodes = (node as unknown as NodeSchemaNested<any>)?.nodes
    const nodesArray = [...(Array.isArray(nodes) ? nodes : [])].filter(Boolean)
    accumulator[node.$id] = {
      ...node,
      parentId,
      nodes: [...nodesArray]
        .map((i) => {
          if (_isStrT(i)) return i
          if (_isObj(i)) return i.$id
          return null
        })
        .filter(Boolean),
    }
    denormalizeNodes(nodesArray, node.$id, accumulator)
  }

  return accumulator
}

export function processNodesToDenormalized(
  value:
    | NodeSchemaNested<any>[]
    | NodeSchemaNested<any>
    | Record<NodeId, NodeSchema>,
): Record<NodeId, NodeSchema<any>> {
  let response: Record<NodeId, NodeSchema<any>> = {}
  const isArray = Array.isArray(value)

  if (isArray && value.length === 1) {
    const item = value[0]
    if (item?.$id === NODE_ROOT_ID) {
      response = denormalizeNodes(
        [{ ...item, parentId: null }],
        NODE_ROOT_ID,
        response,
      )
    } else if (item?.parentId === NODE_ROOT_ID || !item?.parentId) {
      response = denormalizeNodes(
        [{ $id: NODE_ROOT_ID, componentId: 'div', nodes: [item] }],
        NODE_ROOT_ID,
        response,
      )
    } else if (item?.parentId) {
      response = denormalizeNodes(
        [{ $id: item?.parentId, componentId: 'div', nodes: [item] }],
        item?.parentId,
        response,
      )
    } else {
      response = denormalizeNodes(
        [{ $id: NODE_ROOT_ID, componentId: 'div', nodes: [] }],
        NODE_ROOT_ID,
        response,
      )
    }
  } else if (isArray) {
    response = denormalizeNodes(
      [{ $id: NODE_ROOT_ID, componentId: 'div', nodes: [...value] }],
      NODE_ROOT_ID,
      response,
    )
  } else if (
    _isObj(value) &&
    Array.isArray(value?.nodes) &&
    typeof value.nodes[0] !== 'string'
  ) {
    const _value = { ...(value as NodeSchemaNested<any>) }
    response = denormalizeNodes(
      [_value],
      _value?.parentId || NODE_ROOT_ID,
      response,
    )
  } else {
    response = value as unknown as Record<NodeId, NodeSchema>
  }

  return response
}

export function getNodeBreadcrumbPath(nodeId: NodeId): NodeBreadcrumbPath
export function getNodeBreadcrumbPath(node: NodeSchema): NodeBreadcrumbPath
export function getNodeBreadcrumbPath(
  nodeOrId: NodeId | NodeSchema,
): NodeBreadcrumbPath {
  const hierarchy = [NODE_ROOT_ID]

  let currentId = typeof nodeOrId !== 'string' ? nodeOrId?.$id : nodeOrId
  while (currentId && !isRootNodeId(currentId)) {
    hierarchy.splice(1, 0, currentId)
    currentId = getNode(currentId)?.parentId
  }

  return hierarchy as NodeBreadcrumbPath
}

export function getNodeLabelShort(node: NodeSchema) {
  if (isRootNode(node)) return NODE_ROOT_LABEL
  const componentLabel = getComponentLabel(node?.componentId)
  return node?.name || componentLabel || node?.$id
}

// export const NodeSchemaJsonSchema: JSONSchema7 = {
//   $schema: 'https://json-schema.org/draft/2020-12/schema',
//   $id: 'https://aglyn.io/schema/node.schema.json',
//   title: 'Aglyn Node Item',
//   description: 'Aglyn screen node for hydrating view component',
//   type: 'object',
//   additionalProperties: false,
//   properties: {
//     $id: {
//       description: 'The unique identifier for a node',
//       type: 'string',
//     },
//     componentId: {
//       description: 'The unique identifier of the node component',
//       type: 'string',
//     },
//     pluginId: {
//       description: 'The unique identifier of the node component bundle',
//       type: 'string',
//     },
//     parentId: {
//       description: 'The unique identifier of the node parent',
//       type: 'string',
//     },
//     sx: {
//       description: 'The node style properties for emotion',
//       type: 'object',
//     },
//     props: {
//       description: 'The node props/attributes passed to the component',
//       type: 'object',
//     },
//     nodes: {
//       description: 'List of the children unique identifiers for the node',
//       type: 'array',
//       items: {
//         type: 'string',
//       },
//     },
//   },
//   required: ['$id', 'componentId'],
// }
// export const NodeSchemaNestedJsonSchema: JSONSchema7 = {
//   ...NodeSchemaJsonSchema,
//   properties: {
//     ...NodeSchemaJsonSchema.properties,
//     nodes: {
//       ...(NodeSchemaJsonSchema.properties['nodes'] as JSONSchema7),
//       items: {
//         $ref: '#',
//       },
//     },
//   },
// }
