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
import _isArrEmpty from '@aglyn/shared-util-guards/_is-arr-empty'
import _isObj from '@aglyn/shared-util-guards/_is-obj'
import _isStrT from '@aglyn/shared-util-guards/_is-str-t'
import arraySafe from '@aglyn/shared-util-tools/array/array-safe'
import cloneDeep from 'lodash-es/cloneDeep'
import { makeAutoObservable, observable, runInAction, toJS } from 'mobx'
import {
  type ComponentId,
  type ComponentSchema,
  getComponentLabel,
  getSchema,
} from '../components-manager/components-manager'
import { createIdUrlSafe } from '../constants'
import { AglynEvent, emitter } from '../emit-manager'
import type { PluginId } from '../plugin-manager'

export enum NodeType {
  NODE = 'node',
  TEXT = 'text',
  SCREEN = 'screen',
  REF = 'ref',
  PRESET = 'preset',
}

export type NodeId = string

export interface AbstractNodeSchema<TYPE extends NodeType = any> {
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

export interface NodeSchema<P = JSX.AnyProps>
  extends AbstractNodeSchema<NodeType.NODE> {
  /**
   * The unique identifier of the node component
   */
  componentId?: ComponentId
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
  readonly parent?: NodeSchema<any> | null
  /**
   * The computed node parent (only for type completion)
   */
  readonly children?: NodeSchema<any>[]
  /**
   * The computed index in parent nodes (only for type completion)
   */
  readonly index?: number | null
  /**
   * The computed label (only for type completion)
   */
  readonly labelShort?: string | undefined
  /**
   * The computed breadcrumb path (only for type completion)
   */
  readonly breadcrumbPath?: NodeBreadcrumbPath
  /**
   * The computed component schema (only for type completion)
   */
  readonly componentSchema?: ComponentSchema | undefined
  /**
   * The computed guard for of child nodes (only for type completion)
   */
  readonly hasNodes?: boolean
}

export type NodeSchemaJSON<P = JSX.AnyProps> = Omit<
  NodeSchema<P>,
  | 'parent'
  | 'index'
  | 'labelShort'
  | 'breadcrumbPath'
  | 'componentSchema'
  | 'hasNodes'
>

export type NodeSchemaNested<P = JSX.AnyProps> = Omit<
  NodeSchemaJSON<P>,
  'nodes'
> & { nodes?: NodeSchemaNested<any>[] }

export type NodeBreadcrumbPath = [
  root: string & typeof NODE_ROOT_ID,
  ...nodes: [...ancestors: NodeId[], node: NodeId],
]

export const NODE_ROOT_ID = '_@_'
export const NODE_ID_LENGTH = 10
export const NODE_ROOT_LABEL = 'Document'

export const nodes = observable<Record<NodeId, NodeSchema<any>>>({})

emitter.on(AglynEvent.NODE_CLEAR_ITEMS, () => {
  clearNodes()
})
emitter.on(AglynEvent.NODE_SET_ITEMS, ({ nodes }) => {
  setNodes(nodes)
})
emitter.on(AglynEvent.NODE_SET, ({ node, create }) => {
  setNode(node, create)
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

export function createNodeId(): NodeId {
  return createIdUrlSafe(NODE_ID_LENGTH)
}

export function isRootNodeId(id: NodeId): id is typeof NODE_ROOT_ID {
  return id === NODE_ROOT_ID
}

export class AglynNode<P = JSX.AnyProps> implements NodeSchema<P> {
  public name: string
  public type: NodeType.NODE = NodeType.NODE
  public $id: NodeId
  public pluginId?: PluginId
  public componentId?: ComponentId
  public parentId?: NodeId
  public nodes?: NodeId[]
  public props?: P
  public sx?: JSX.SxProps
  public className?: string

  get parent(): NodeSchema<any> | null {
    return getNode(this.parentId)
  }
  get index(): number | null {
    return getNodeIndex(this)
  }
  get children(): NodeSchema<any>[] {
    const res: NodeSchema[] = []
    for (const $id of this.nodes) {
      const node = getNode($id)
      res.push(node)
    }
    return res
  }
  get labelShort(): string {
    return getNodeLabelShort(this)
  }
  get breadcrumbPath(): NodeBreadcrumbPath {
    return getNodeBreadcrumbPath(this)
  }
  get componentSchema(): ComponentSchema | undefined {
    return getNodeComponentSchema(this)
  }
  get hasNodes(): boolean {
    return Array.isArray(this.nodes) && this.nodes.length > 0
  }

  constructor(schema: NodeSchema<P>) {
    this.$id = schema.$id
    this.name = schema.name
    this.type = schema.type || NodeType.NODE
    this.parentId = schema.parentId
    this.pluginId = schema.pluginId
    this.componentId = schema.componentId
    this.className = schema.className
    this.nodes = Array.isArray(schema.nodes) ? [...schema.nodes] : []
    this.props = { ...schema.props } as P
    this.sx = Array.isArray(schema.sx) ? [...schema.sx] : { ...schema.sx }

    makeAutoObservable(this)
  }

  public toJSON(): NodeSchemaJSON<P> {
    return nodeToJSON(this)
  }
}

export function isRootNode(node: NodeSchema<any>): boolean {
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

export function clearNodes() {
  runInAction(() => {
    for (const nodeId in nodes) delete nodes[nodeId]
  })
}

export function createNode<P = JSX.AnyProps>(
  schema: PartialKeys<NodeSchema<P>, '$id'>,
): NodeSchema<P> {
  return new AglynNode<P>({ ...schema, $id: schema?.$id ?? createNodeId() })
}

export function setNode(node: NodeSchema<any>, create = false) {
  if (!node || (!create && !node.$id)) throw new Error('Invalid node')
  return runInAction(() => {
    return (nodes[node?.$id] = create ? createNode(node) : node)
  })
}

export function setNodes(values: Record<NodeId, NodeSchema<any>>) {
  if (!values) return
  for (const nodeId in values) {
    const schema = values[nodeId]
    if (!schema) continue
    const node = createNode(schema)

    runInAction(() => setNode(node))
  }
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
  const parent = node?.parent
  if (!node || !parent) return
  return parent?.nodes?.indexOf(node.$id)
}

export function isNodeFirstIndex(node: NodeSchema<any>) {
  return getNodeIndex(node) === 0
}

export function isNodeLastIndex(node: NodeSchema<any>) {
  const parent = node?.parent
  if (!node || !parent) return
  return getNodeIndex(node) + 1 === (parent?.nodes || []).length
}

export function getNodeComponentSchema(node: NodeSchema<any>): ComponentSchema {
  return getSchema(node?.componentId)
}

export function deleteNode<P = JSX.AnyProps>(node: NodeSchema<P>) {
  if (!node || isRootNode(node)) return
  if (!_isArrEmpty(node.nodes)) {
    for (const childId of node.nodes) {
      deleteNode(getNode(childId))
    }
  }

  runInAction(() => {
    const index = node.parent.nodes.indexOf(node.$id)
    if (index >= 0) node.parent.nodes.splice(index, 1)
    delete nodes[node.$id]
  })
}

function deleteChildNodes(node: NodeSchema<any>) {
  const childNodes = Array.isArray(node.nodes) ? node.nodes : []
  for (const childId of childNodes) {
    runInAction(() => {
      const child = getNode(childId)
      if (child) deleteNode(child)
    })
  }
}

export function reparentNode(
  node: NodeSchema<any>,
  newParent: NodeSchema<any>,
  index = NaN,
) {
  if (!node || isRootNode(node)) throw new Error('Invalid node')
  if (!newParent) throw new Error('Invalid parent node')

  const oldParent = node?.parent
  if (oldParent?.$id === newParent.$id) return reorderNode(node, index)

  const oldIndex = oldParent.nodes?.indexOf(node?.$id)
  if (oldIndex >= 0) runInAction(() => oldParent.nodes.splice(oldIndex, 1))

  runInAction(() => {
    node.parentId = newParent?.$id
    if (isNaN(index)) newParent.nodes.push(node?.$id)
    else newParent.nodes.splice(index, 0, node?.$id)
  })
}

export function reorderNode(node: NodeSchema<any>, newIndex = NaN) {
  if (!node || !node.$id || !node?.parent) {
    console.error('Invalid node or parent', node)
    return
  }
  return runInAction(() => {
    node.parent.nodes.splice(node?.index, 1)
    if (isNaN(newIndex)) {
      node.parent.nodes.push(node?.$id)
    } else {
      node.parent.nodes.splice(newIndex, 0, node?.$id)
    }
    return node
  })
}

export function removeNodeFromParent(node: NodeSchema<any>) {
  const parent = getNode(node?.parentId)
  const index = getNodeIndex(node)
  if (!node || !parent || !(index >= 0)) return

  runInAction(() => {
    node.parentId = null
    parent.nodes.splice(node?.index, 1)
  })
}

export function addNodeToParent(
  node: NodeSchema<any>,
  parent: NodeSchema<any>,
  index = NaN,
) {
  if (!node || !parent || parent.nodes?.some((id) => id === node.$id)) return
  runInAction(() => {
    if (isNaN(index)) {
      parent.nodes.push(node.$id)
    } else {
      parent.nodes.unshift(node.$id)
    }

    node.parentId = parent.$id
  })
  setNode(node)
}

export function duplicateNode<P = JSX.AnyProps>(
  node: NodeSchema<P>,
): NodeSchema<P> {
  if (!node) throw new Error('Invalid node')
  const parent = getNode(node?.parentId)
  const index = (getNodeIndex(node) || 0) + 1
  const newNode = duplicateNodeAndChildren(node, node?.parentId)
  parent.nodes.splice(index, 0, newNode.$id)
  return newNode
}

function duplicateNodeAndChildren<P = JSX.AnyProps>(
  node: NodeSchema<P>,
  parentId: NodeId,
): NodeSchema<P> {
  if (!node) return
  const json = nodeToJSON(node)
  const newNode = setNode(
    createNode({
      ...json,
      $id: createNodeId(),
      parentId,
      nodes: [],
    }),
  )

  for (const childId of arraySafe(json?.nodes)) {
    const childNode = duplicateNodeAndChildren(getNode(childId), newNode.$id)
    if (!childNode) continue
    runInAction(() => {
      newNode.nodes.push(childNode?.$id)
    })
  }

  console.log('node node', node, newNode, json)

  return newNode
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
    response = value as unknown as Record<NodeId, NodeSchema<any>>
  }

  return response
}

export function getNodeBreadcrumbPath(nodeId: NodeId): NodeBreadcrumbPath
export function getNodeBreadcrumbPath(node: NodeSchema<any>): NodeBreadcrumbPath
export function getNodeBreadcrumbPath(
  nodeOrId: NodeId | NodeSchema<any>,
): NodeBreadcrumbPath {
  const hierarchy = [NODE_ROOT_ID]

  let currentId = typeof nodeOrId !== 'string' ? nodeOrId?.$id : nodeOrId
  while (currentId && !isRootNodeId(currentId)) {
    hierarchy.splice(1, 0, currentId)
    currentId = getNode(currentId)?.parentId
  }

  return hierarchy as NodeBreadcrumbPath
}

export function getNodeLabelShort(node: NodeSchema<any>) {
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
