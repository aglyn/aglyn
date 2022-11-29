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

import { HostUid } from '@aglyn/core-data-foundation'
import type { PartialKeys } from '@aglyn/shared-data-types'
import _isObj from '@aglyn/shared-util-guards/_is-obj'
import _isStrT from '@aglyn/shared-util-guards/_is-str-t'
import { ITimestamp } from '@aglyn/shared-util-timestamp'
import arraySafe from '@aglyn/shared-util-tools/array/array-safe'
import cloneDeep from 'lodash-es/cloneDeep'
import isEqual from 'lodash-es/isEqual'
import { makeAutoObservable, observable, runInAction, toJS } from 'mobx'
import { computedFn } from 'mobx-utils'
import {
  type ComponentId,
  type ComponentSchema,
  getComponentLabel,
  getSchema,
  type PresetSchema,
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

export type NodesMap = Record<NodeId, NodeSchema<any>>

export interface ScreenSchema {
  nodes: NodeSchemaNested
  createdAt?: ITimestamp
  updatedAt?: ITimestamp
  hostId?: HostUid
}

export type NodeBreadcrumbPath = [
  root: string & typeof NODE_ROOT_ID,
  ...nodes: [...ancestors: NodeId[], node: NodeId],
]

export const NODE_ROOT_ID = '_@_'
export const NODE_ID_LENGTH = 10
export const NODE_ROOT_LABEL = 'Document'

export interface ScreenState {
  _initial: NodesMap
  _history: NodesMap[]
  _activeIndex: number

  readonly nodes: NodesMap
  readonly canRedo: boolean
  readonly canUndo: boolean
  readonly isInitialSame: boolean
  readonly didSetInitial: boolean
  readonly rootNode: NodeSchema<any>
  hasNode: ($id: NodeId) => boolean
  getNode: ($id: NodeId) => NodeSchema<any> | undefined
  nodesAreEqual: (left: NodesMap, right?: NodesMap) => boolean
  isRootNodeId: (id: NodeId) => id is string & typeof NODE_ROOT_ID
  isRootNode: (node: NodeSchema<any>) => boolean
  getNodeIndex: (node: NodeSchema<any>) => number
  getNodeParent: (node: NodeSchema<any>) => typeof node['parent']
  getNodeBreadcrumbPath: (
    nodeOrId: NodeId | NodeSchema<any>,
  ) => NodeBreadcrumbPath
  getNodeLabelShort: (node: NodeSchema<any>) => any
  redo(): void
  undo(): void
  saveHistory(): void
  clearHistory(): void
  clearNodes(): void
  updateInitialNodes(nodes?: NodesMap): NodesMap
  setNode(node: NodeSchema<any>, create?: boolean): NodeSchema<any>
  setNodes(nodes: NodesMap): NodesMap
  deleteNode(node: NodeSchema<any>)
  reparentNode(
    node: NodeSchema<any>,
    newParent: NodeSchema<any>,
    index?: number,
  ): typeof node
  reorderNode(node: NodeSchema<any>, index?: number): typeof node
  duplicateNode(node: NodeSchema<any>): NodeSchema<any>
  addNodeFromPreset(
    preset: PresetSchema<any>,
    parent: NodeSchema<any>,
    index?: number,
  ): NodeSchema<any>
}

export const state = observable<ScreenState>({
  _initial: null,
  _history: [{}],
  _activeIndex: 0,

  get nodes() {
    console.log(
      'nodes active',
      this._activeIndex,
      this._history.length,
      this._history[this._activeIndex],
    )
    return this._history[this._activeIndex]
  },
  get canRedo() {
    return this._activeIndex < this._history.length - 1
  },
  get canUndo() {
    return this._activeIndex > 0
  },
  get isInitialSame() {
    return isEqual(toJS(this._initial), toJS(this.nodes))
  },
  get didSetInitial() {
    return Boolean(this._initial)
  },
  get rootNode() {
    return this._history[this._activeIndex][NODE_ROOT_ID]
  },

  hasNode: computedFn(($id: NodeId): boolean => {
    return Boolean(state.nodes[$id])
  }),
  getNode: computedFn(($id: NodeId): NodeSchema<any> | undefined => {
    return state.nodes[$id]
  }),
  nodesAreEqual: computedFn((left: NodesMap, right?: NodesMap): boolean => {
    const _right = right ? right : state.nodes
    return isEqual(toJS(left), toJS(_right))
  }),
  getNodeParent: computedFn((node: NodeSchema<any>): NodeSchema<any> => {
    if (!node) throw new Error('Invalid node')
    return state.getNode(node.parentId)
  }),
  getNodeIndex: computedFn((node: NodeSchema<any>): number => {
    if (!node) throw new Error('Invalid node')
    const parent = state.getNodeParent(node)
    if (!parent) throw new Error('Invalid parent node')
    return parent.nodes?.indexOf(node.$id)
  }),
  isRootNodeId: computedFn((id: NodeId): id is string & typeof NODE_ROOT_ID => {
    return id === NODE_ROOT_ID
  }),
  isRootNode: computedFn((node: NodeSchema<any>): boolean => {
    return node?.$id === NODE_ROOT_ID
  }),
  getNodeBreadcrumbPath: computedFn(
    (nodeOrId: NodeId | NodeSchema<any>): NodeBreadcrumbPath => {
      const hierarchy = [NODE_ROOT_ID]

      let currentId = typeof nodeOrId !== 'string' ? nodeOrId?.$id : nodeOrId
      while (currentId && !isRootNodeId(currentId)) {
        hierarchy.splice(1, 0, currentId)
        currentId = getNode(currentId)?.parentId
      }

      return hierarchy as NodeBreadcrumbPath
    },
  ),
  getNodeLabelShort: computedFn((node: NodeSchema<any>): any => {
    if (isRootNode(node)) return NODE_ROOT_LABEL
    const componentLabel = getComponentLabel(node?.componentId)
    return node?.name || componentLabel || node?.$id
  }),

  redo() {
    console.log('redo', this.canRedo, this._activeIndex)
    if (this.canRedo) this._activeIndex = this._activeIndex + 1
  },
  undo() {
    console.log('undo', this.canUndo, this._activeIndex)
    if (this.canUndo) this._activeIndex = this._activeIndex - 1
  },
  saveHistory() {
    const state = toJS(this._history[this._activeIndex])
    this._history.splice(this._activeIndex, 0, state)
    this._history.splice(this._activeIndex + 2, this._history.length)
    this._activeIndex = this._history.length - 1
  },
  clearHistory() {
    this._history = [{}]
    this._activeIndex = 0
  },
  clearNodes() {
    return (this._history[this._activeIndex] = {})
  },
  updateInitialNodes(nodes?: NodesMap) {
    const value = nodes ? nodes : this._history[this._activeIndex]
    return (this._initial = toJS(value))
  },
  setNode(node: NodeSchema<any>, create = false) {
    if (!node || (!create && !node.$id)) throw new Error('Invalid node')
    const _node = create ? createNode(node) : node
    return (this.nodes[_node?.$id] = _node)
  },
  setNodes(schemas: NodesMap): NodesMap {
    if (!schemas) throw new Error('Invalid schemas')
    const cloned = cloneDeep(schemas)
    const nodes = {}
    for (const nodeId in cloned) {
      if (!cloned[nodeId]) continue
      nodes[nodeId] = createNode(cloned[nodeId])
    }
    return (this._history[this._activeIndex] = nodes)
  },
  deleteNode(node: NodeSchema<any>) {
    if (!node) throw new Error('Invalid node')
    if (isRootNode(node)) throw new Error('Cannot delete root node')
    this.saveHistory()
    const parent = this.getNode(node.parentId)
    const index = parent.nodes.indexOf(node.$id)
    for (const childId of toJS(node.nodes)) {
      const child = this.getNode(childId)
      this.deleteNode(child)
    }

    if (index > -1) parent.nodes.splice(index, 1)
    delete this.nodes[node.$id]
  },
  reparentNode(
    node: NodeSchema<any>,
    newParent: NodeSchema<any>,
    index = NaN,
  ): typeof node {
    if (!node) throw new Error('Invalid node')
    if (isRootNode(node)) throw new Error('Cannot move root node')
    if (!newParent) throw new Error('Invalid parent node')

    this.saveHistory()
    const oldParent = this.getNodeParent(node)
    const oldIndex = oldParent?.nodes?.indexOf(node?.$id)
    if (oldIndex > -1) oldParent.nodes.splice(oldIndex, 1)
    if (oldParent?.$id !== newParent.$id) node.parentId = newParent?.$id

    if (isNaN(index)) newParent.nodes.push(node?.$id)
    else newParent.nodes.splice(index, 0, node?.$id)
    return node
  },
  reorderNode(node: NodeSchema<any>, index = NaN): typeof node {
    return this.reparentNode(node, this.getNodeParent(node), index)
  },
  duplicateNode(node: NodeSchema<any>): NodeSchema<any> {
    if (!node) throw new Error('Invalid node')
    if (isRootNode(node)) throw new Error('Cannot duplicate root node')
    const parent = this.getNodeParent(node)
    if (!parent) throw new Error('Invalid parent node')

    const duplicateNodeAndChildren = (
      node: NodeSchema<any>,
      parentId: NodeId,
    ): NodeSchema<any> => {
      if (!node) return

      const json = toJS(node)
      const newNode = this.setNode(
        createNode({ ...json, $id: createNodeId(), parentId, nodes: [] }),
      )
      for (const childId of arraySafe(json?.nodes)) {
        const childNode = duplicateNodeAndChildren(
          this.getNode(childId),
          newNode.$id,
        )
        if (childNode) newNode.nodes.push(childNode?.$id)
      }

      return newNode
    }

    this.saveHistory()
    const nodeIndex = this.getNodeIndex(node)
    const index = nodeIndex === -1 ? parent.nodes.length - 1 : nodeIndex + 1
    const newNode = duplicateNodeAndChildren(node, node?.parentId)
    parent.nodes.splice(index, 0, newNode.$id)

    return newNode
  },
  addNodeFromPreset(
    preset: PresetSchema<any>,
    parent: NodeSchema<any>,
    index = NaN,
  ): NodeSchema<any> {
    if (!preset) throw new Error('Invalid preset')
    if (!parent) throw new Error('Invalid parent node')
    this.saveHistory()
    const presetJS = toJS(preset)
    const duplicate = createDuplicateNode(presetJS.data)
    duplicate.parentId = parent.$id
    const parsed = processNodesToDenormalized(duplicate)
    this.setNodes(parsed)

    if (isNaN(index)) parent.nodes.push(duplicate.$id)
    else parent.nodes.splice(index, 0, duplicate.$id)

    return this.getNode(duplicate.$id)
  },
})

export class AglynNode<P = JSX.AnyProps> implements NodeSchema<P> {
  public $id: NodeId
  public name: string
  public type: NodeType.NODE = NodeType.NODE
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
    return toJS(this)
  }
}

export function updateInitialNodes(nodes?: NodesMap): NodesMap {
  return runInAction(() => state.updateInitialNodes())
}
export function clearHistory() {
  return runInAction(() => state.clearHistory())
}
export function saveHistory() {
  return runInAction(() => state.saveHistory())
}
export function canUndo() {
  return state.undo
}
export function undo() {
  return runInAction(() => state.undo())
}
export function canRedo() {
  return state.canRedo
}
export function redo() {
  return runInAction(() => state.redo())
}

export function createNodeId(): NodeId {
  return createIdUrlSafe(NODE_ID_LENGTH)
}

export function isRootNodeId(id: NodeId): id is typeof NODE_ROOT_ID {
  return id === NODE_ROOT_ID
}

export function isRootNode(node: NodeSchema<any>): boolean {
  return node?.$id === NODE_ROOT_ID
}

export function nodesToJSON(nodes?: NodesMap): NodesMap {
  const _nodes = nodes ? nodes : state.nodes
  return toJS(_nodes)
}

export function toJSON() {
  return {
    nodes: nodesToJSON(),
  }
}

export function nodeToJSON(node: NodeSchema<any>): NodeSchemaJSON<any> {
  return toJS(node)
}

export function clearNodes() {
  return runInAction(() => state.clearNodes())
}

export function createNode(
  schema: PartialKeys<NodeSchema<any>, '$id'>,
): NodeSchema<any> {
  return new AglynNode<any>({ ...schema, $id: schema?.$id ?? createNodeId() })
}

export function setNode(node: NodeSchema<any>, create = false) {
  return runInAction(() => state.setNode(node, create))
}

export function setNodes(schemas: NodesMap) {
  return runInAction(() => state.setNodes(schemas))
}

export function hasNode($id: NodeId): boolean {
  return runInAction(() => state.hasNode($id))
}

export function getNode($id: NodeId): NodeSchema<any> | undefined {
  return state.getNode($id)
}

export function getNodeIndex(node: NodeSchema<any>) {
  return runInAction(() => state.getNodeIndex(node))
}

export function getNodeComponentSchema(node: NodeSchema<any>): ComponentSchema {
  return getSchema(node?.componentId)
}

export function deleteNode(node: NodeSchema<any>) {
  return runInAction(() => state.deleteNode(node))
}

export function reparentNode(
  node: NodeSchema<any>,
  newParent: NodeSchema<any>,
  index?: number,
) {
  return runInAction(() => state.reparentNode(node, newParent, index))
}

export function reorderNode(node: NodeSchema<any>, index = NaN) {
  return runInAction(() => state.reorderNode(node, index))
}

export function createDuplicateNode(
  node: NodeSchemaNested<any>,
): NodeSchemaNested<any> {
  const $id = createNodeId()
  const cloned = toJS(node)
  const nodes = Array.isArray(cloned?.nodes) ? [...cloned.nodes] : []
  const res = { ...cloned, $id, nodes: [] }
  for (const child of nodes) {
    const childDuplicate = createDuplicateNode({ ...child, parentId: $id })
    res.nodes.push(childDuplicate)
  }
  return res
}

export function addNodeFromPreset(
  preset: PresetSchema<any>,
  parent: NodeSchema<any>,
  index = NaN,
) {
  return runInAction(() => state.addNodeFromPreset(preset, parent, index))
}

export function duplicateNode(node: NodeSchema<any>): NodeSchema<any> {
  return runInAction(() => state.duplicateNode(node))
}

export function nestNodes(
  nodes: NodesMap,
  rootNode: NodeSchema<any>,
): NodeSchemaNested<any> {
  console.log('nestNodes', rootNode, toJS(nodes))
  if (!nodes) throw new Error('Invalid nodes')
  if (!rootNode) throw new Error('Invalid root node')
  const parent = toJS(rootNode) as unknown as NodeSchemaNested<any>

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
  accumulator: NodesMap = {},
): NodesMap {
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

export type ProcessableNodes =
  | NodeSchemaNested<any>[]
  | NodeSchemaNested<any>
  | Record<NodeId, NodeSchema>

export function processNodesToDenormalized(value: ProcessableNodes): NodesMap {
  let response: NodesMap = {}
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
    response = value as unknown as NodesMap
  }

  return response
}

export function getNodeBreadcrumbPath(nodeId: NodeId): NodeBreadcrumbPath
export function getNodeBreadcrumbPath(node: NodeSchema<any>): NodeBreadcrumbPath
export function getNodeBreadcrumbPath(
  nodeOrId: NodeId | NodeSchema<any>,
): NodeBreadcrumbPath {
  return state.getNodeBreadcrumbPath(nodeOrId)
}

export function getNodeLabelShort(node: NodeSchema<any>) {
  return state.getNodeLabelShort(node)
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
emitter.on(AglynEvent.NODE_REPARENT, ({ node, newParent, index }) => {
  reparentNode(node, newParent, index)
})
