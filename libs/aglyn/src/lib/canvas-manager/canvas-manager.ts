/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import { _isObj, _isStrT } from '@aglyn/shared-util-tools'
import arraySafe from '@aglyn/shared-util-tools/array/array-safe'
import cloneDeep from 'lodash-es/cloneDeep'
import isEqual from 'lodash-es/isEqual'
import {
  action,
  computed,
  type IObservableArray,
  makeAutoObservable,
  makeObservable,
  observable,
  type ObservableMap,
  runInAction,
  toJS,
} from 'mobx'
import { computedFn } from 'mobx-utils'
import type { Aglyn } from '../aglyn'
import { createIdUrlSafe } from '../constants'
import type { PluginId } from '../plugin-manager'
import {
  type ComponentId,
  type ComponentSchema,
  type NodeBreadcrumbPath,
  type NodeId,
  type NodeSchema,
  type NodeSchemaJSON,
  type NodeSchemaNested,
  type NodesMap,
  NodeType,
  type PresetSchema,
  type ProcessableNodes,
} from '../types/nodes'

export const NODE_ROOT_ID = '_@_'
export const NODE_ROOT_LABEL = 'Document'

export class AglynNode<P = JSX.AnyProps> implements NodeSchema<P> {
  // public store: CanvasManager
  public $id: NodeId
  public name?: string
  public type: NodeType | string
  public pluginId?: PluginId
  public componentId?: ComponentId
  public parentId?: NodeId
  public nodes?: NodeId[]
  public props: P
  public sx?: JSX.SxProps
  public className?: string

  get parent(): NodeSchema<any> | undefined {
    if (!this.parentId) return
    return this.store.getNode(this.parentId)
  }
  get index(): number | null {
    return this.store.getNodeIndex(this)
  }
  get children(): NodeSchema<any>[] {
    const res: NodeSchema[] = []
    for (const $id of (this.nodes ||= [])) {
      const node = this.store.getNode($id)
      if (node) res.push(node)
    }
    return res
  }
  get labelShort(): string {
    return this.store.getNodeLabelShort(this)
  }
  get breadcrumbPath(): NodeBreadcrumbPath {
    return this.store.getNodeBreadcrumbPath(this)
  }
  get componentSchema(): ComponentSchema | undefined {
    if (!this.componentId) return
    return this.store.aglyn.components.getSchema(this.componentId)
  }
  get hasNodes(): boolean {
    return Array.isArray(this.nodes) && this.nodes.length > 0
  }
  get resolvedProps(): P {
    const resolveProps = this.componentSchema?.resolveProps
    if (typeof resolveProps === 'function') {
      return (resolveProps(this) || {}) as P
    }
    return this.props
  }

  get asJSON(): NodeSchemaJSON<P> {
    return this.toJSON()
  }

  constructor(
    schema: NodeSchema<P>,
    public store: CanvasManager,
  ) {
    makeAutoObservable(this, {
      store: false,
      toJSON: false,
    })

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

    // this.store = store
    // console.log('canvas node', this)
  }

  public delete() {
    this.store.deleteNode(this)
  }

  public toJSON = (): NodeSchemaJSON<P> => {
    const json: Record<string, unknown> = {
      $id: this.$id,
      type: this.type,
    }
    // Omit optional scalar fields when undefined — Firestore rejects undefined values
    if (this.name !== undefined) json['name'] = this.name
    if (this.parentId !== undefined) json['parentId'] = this.parentId
    if (this.pluginId !== undefined) json['pluginId'] = this.pluginId
    if (this.componentId !== undefined) json['componentId'] = this.componentId
    if (this.className !== undefined) json['className'] = this.className
    // Omit collection fields when empty to save Firestore storage
    const nodes = this.nodes ? [...this.nodes] : []
    if (nodes.length > 0) json['nodes'] = nodes
    const props = toJS(this.props)
    if (props && Object.keys(props).length > 0) json['props'] = props
    const sx = toJS(this.sx)
    const sxEmpty = Array.isArray(sx) ? sx.length === 0 : !sx || Object.keys(sx).length === 0
    if (!sxEmpty) json['sx'] = sx
    return json as NodeSchemaJSON<P>
  }
}

class HistoryManager<K extends string, T> {
  public present = observable.map<K, T>({})
  public past = observable.array<Map<K, T>>([], { deep: false })
  public future = observable.array<Map<K, T>>([], { deep: false })

  constructor() {
    makeObservable(this, {
      canUndo: computed,
      canRedo: computed,
      undo: action,
      redo: action,
      clearPast: action,
      clearFuture: action,
      clearHistory: action,
      saveHistory: action,
    })
  }

  public get [Symbol.toStringTag]() {
    return 'HistoryManager'
  }

  public toString(): string {
    return '[object HistoryManager]'
  }

  public toJSON(): {
    past: IObservableArray<Map<K, T>>
    present: ObservableMap<K, T>
    future: IObservableArray<Map<K, T>>
  } {
    return {
      past: toJS(this.past),
      present: toJS(this.present),
      future: toJS(this.future),
    }
  }

  public get canUndo() {
    return this.past.length >= 1
  }

  public get canRedo() {
    return this.future.length >= 1
  }

  public undo(): Map<K, T> {
    if (!this.canUndo) throw new Error('No history to undo')
    this.future.push(toJS(this.present))
    return this.past.pop()!
  }

  public redo(): Map<K, T> {
    if (!this.canRedo) throw new Error('No history to redo')
    this.past.push(toJS(this.present))
    return this.future.pop()!
  }

  public clearPast(): this {
    this.past.clear()
    return this
  }

  public clearFuture(): this {
    this.future.clear()
    return this
  }

  public clearHistory(): this {
    this.clearPast()
    this.clearFuture()
    return this
  }

  public saveHistory(): this {
    this.clearFuture()
    console.log(
      'save history',
      toJS(Object.fromEntries(this.present.entries())),
    )
    this.past.push(toJS(this.present))
    return this
  }
}

export class CanvasManager {
  private _initial: NodesMap | undefined
  private _history: HistoryManager<NodeId, NodeSchema<any>>

  constructor(public aglyn: Aglyn) {
    makeObservable(this, {
      nodes: computed,
      undo: action,
      redo: action,
      saveHistory: action,
      clearHistory: action,
      clearNodes: action,
      updateInitialNodes: action,
      setNode: action,
      setNodes: action,
      deleteNode: action,
      reparentNode: action,
      reorderNode: action,
      updateNodeProps: action,
    })

    this._history = new HistoryManager()
  }

  public get nodes() {
    return this._history.present
  }

  public get canRedo() {
    return this._history.canRedo
  }
  public get canUndo() {
    return this._history.canUndo
  }
  public get isInitialSame() {
    return isEqual(toJS(this._initial), toJS(this.nodes))
  }
  public get didSetInitial() {
    return Boolean(this._initial)
  }
  public get rootNode() {
    return this.nodes.get(NODE_ROOT_ID)
  }
  public get nestedNodes(): NodeSchemaNested<any> {
    const root = this.rootNode
    console.log('root', this.rootNode, this.nodes)
    if (!root) throw new Error('Missing root node')
    return this.makeNested(root)
  }

  public hasNode = computedFn(($id: NodeId): boolean => {
    return this.nodes.has($id)
  })
  public getNode = computedFn(($id: NodeId): NodeSchema<any> | undefined => {
    if (!$id) return
    return this.nodes.get($id)
  })
  public nodesAreEqual = computedFn(
    (left: NodesMap, right?: NodesMap): boolean => {
      const _right = right ? right : this.nodes
      return isEqual(toJS(left), toJS(_right))
    },
  )
  public getNodeParent = computedFn(
    (node: NodeSchema<any>): NodeSchema<any> | undefined => {
      if (!node) throw new Error('Invalid node')
      if (!node.parentId) return
      return this.getNode(node.parentId)
    },
  )
  public getNodeIndex = computedFn((node: NodeSchema<any>): number => {
    if (!node || !node.$id) throw new Error('Invalid node')
    const parent = this.getNodeParent(node)
    if (!parent) throw new Error('Invalid parent node')
    return parent.nodes?.indexOf(node.$id) ?? -1
  })
  public isRootNodeId = computedFn(
    (id: NodeId): id is string & typeof NODE_ROOT_ID => {
      return id === NODE_ROOT_ID
    },
  )
  public isRootNode = computedFn((node: NodeSchema<any>): boolean => {
    return node?.$id === NODE_ROOT_ID
  })
  public getNodeBreadcrumbPath = computedFn(
    (nodeOrId: NodeId | NodeSchema<any>): NodeBreadcrumbPath => {
      const hierarchy = [NODE_ROOT_ID]

      let currentId: string | undefined =
        typeof nodeOrId !== 'string' ? nodeOrId?.$id : nodeOrId
      while (currentId && !this.isRootNodeId(currentId)) {
        hierarchy.splice(1, 0, currentId)
        currentId = this.getNode(currentId)?.parentId
      }

      return hierarchy as NodeBreadcrumbPath
    },
  )
  public getNodeLabelShort = computedFn((node: NodeSchema<any>): any => {
    if (!node) throw new Error('Invalid node')
    if (this.isRootNode(node)) return NODE_ROOT_LABEL
    const componentLabel =
      node.componentId && this.aglyn.components.getLabel(node.componentId)
    return node?.name || componentLabel || node?.$id
  })

  public makeNested = computedFn((node: NodeSchema<any>) => {
    const newNode = toJS(node) as unknown as NodeSchemaNested<any>

    const childNodes: NodeSchemaNested<any>[] = []
    for (const childId of (newNode.nodes ||= []) as unknown as NodeId[]) {
      const child = this.getNode(childId)
      if (child) {
        const nested = this.makeNested(child)
        childNodes.push(nested)
      }
    }
    newNode.nodes = childNodes

    return newNode
  })

  public toJSON() {
    const nodes: NodesMap = {}
    this.nodes.forEach((node, id) => {
      nodes[id] = node.toJSON()
    })
    return { nodes }
  }

  public redo(): this {
    const state = this._history.redo()
    const json = Object.fromEntries(state!.entries())
    console.log('redo', json)
    console.log('redo present state', this.nodes.get(NODE_ROOT_ID)!.nodes)
    this.setNodes(json)
    console.log('redo new state', this.nodes.get(NODE_ROOT_ID)!.nodes)
    return this
  }
  public undo(): this {
    const state = this._history.undo()
    const json = Object.fromEntries(state!.entries())
    console.log('undo', json)
    console.log('undo present state', this.nodes.get(NODE_ROOT_ID)!.nodes)
    this.setNodes(json)
    console.log('undo new state', this.nodes.get(NODE_ROOT_ID)!.nodes)
    return this
  }
  public saveHistory(): this {
    this._history.saveHistory()
    return this
  }
  public clearHistory() {
    this._history.clearPast()
  }
  public createNodeId(): NodeId {
    return createIdUrlSafe()
  }
  public createNode(
    schema: PartialKeys<NodeSchema<any>, '$id'>,
  ): NodeSchema<any> {
    return new AglynNode<any>(
      {
        ...schema,
        $id: schema?.$id || this.createNodeId(),
      } as NodeSchema<any>,
      this,
    )
  }
  public clearNodes() {
    this.nodes.clear()
    return this
  }
  public updateInitialNodes(nodes?: NodesMap) {
    this._initial = toJS(nodes || this.nodes) as NodesMap
    return this
  }
  public setNode(node: NodeSchema<any>, create = false) {
    if (!node) throw new Error('Invalid node')
    if (!create && !node.$id) throw new Error('Invalid node id')
    const _node = create ? this.createNode(node) : node
    this.nodes.set(_node.$id!, _node)
    return this.nodes.get(_node.$id)
  }
  public setNodes(schemas: NodesMap, merge = false): this {
    if (!schemas) throw new Error('Invalid schemas')
    const cloned = toJS(schemas)
    const nodes: Record<NodeId, NodeSchema<any>> = {}
    for (const nodeId in cloned) {
      const node = cloned[nodeId]
      if (node.$id === NODE_ROOT_ID) console.log('root node!!!!!!', node)
      if (node) nodes[nodeId] = this.createNode(node)
    }
    if (merge) {
      this.nodes.merge(nodes)
    } else {
      this.nodes.replace(nodes)
    }
    return this
  }
  public deleteNode(node: NodeSchema<any>): this {
    const validateNode = (node: NodeSchema<any>) => {
      if (!node || !node?.$id || !node?.parentId)
        throw new Error('Invalid node')
      if (this.isRootNode(node)) throw new Error('Cannot delete root node')
    }

    validateNode(node)
    this.saveHistory()

    const del = (node: NodeSchema<any>) => {
      validateNode(node)
      const parent = this.getNode(node.parentId!)
      if (!parent) throw new Error('Invalid parent node')
      const index = parent.nodes?.indexOf(node.$id) ?? -1
      const nodes = toJS(node.nodes || [])

      for (const childId of [...nodes]) {
        const child = this.getNode(childId)
        if (child) del(child)
      }

      if (index > -1) parent.nodes?.splice(index, 1)
      this.nodes.delete(node.$id)
    }
    del(node)
    return this
  }
  public reparentNode(
    node: NodeSchema<any>,
    newParent: NodeSchema<any>,
    index = NaN,
  ): typeof node {
    if (!node) throw new Error('Invalid node')
    if (this.isRootNode(node)) throw new Error('Cannot move root node')
    if (!newParent) throw new Error('Invalid parent node')

    this.saveHistory()
    const oldParent = this.getNodeParent(node)
    const oldIndex = oldParent?.nodes?.indexOf(node?.$id) ?? -1
    if (oldIndex > -1) oldParent?.nodes?.splice(oldIndex, 1)
    if (oldParent?.$id !== newParent.$id) node.parentId = newParent?.$id

    if (isNaN(index)) (newParent.nodes ||= []).push(node?.$id)
    else (newParent.nodes ||= []).splice(index, 0, node?.$id)
    return node
  }
  public reorderNode(node: NodeSchema<any>, index = NaN): typeof node {
    if (!node) throw new Error('Invalid node')
    const parent = this.getNodeParent(node)
    if (!parent) throw new Error('Invalid parent node')
    return this.reparentNode(node, parent, index)
  }
  public duplicateNode(node: NodeSchema<any>): NodeSchema<any> {
    if (!node) throw new Error('Invalid node')
    if (this.isRootNode(node)) throw new Error('Cannot duplicate root node')
    const parent = this.getNodeParent(node)
    if (!parent) throw new Error('Invalid parent node')

    const duplicateNodeAndChildren = (
      node: NodeSchema<any>,
      parentId: NodeId,
    ): NodeSchema<any> => {
      if (!node) throw new Error('Invalid node')

      const json = toJS(node)
      const newNode = this.setNode(
        this.createNode({
          ...json,
          $id: this.createNodeId(),
          parentId,
          nodes: [],
        }),
      )!
      if (!json) return newNode

      for (const childId of arraySafe(json.nodes)) {
        const child = childId && this.getNode(childId)
        if (child) {
          const copy = duplicateNodeAndChildren(child, newNode.$id!)
          if (copy) newNode.nodes!.push(copy.$id!)
        }
      }

      return newNode
    }

    this.saveHistory()
    const nodeIndex = this.getNodeIndex(node)
    const index =
      nodeIndex === -1 ? (parent.nodes?.length ?? 1) - 1 : nodeIndex + 1
    const newNode = duplicateNodeAndChildren(node, node.parentId!)
    ;(parent.nodes ||= []).splice(index, 0, newNode.$id)

    return newNode
  }
  public createDuplicateNode(
    node: NodeSchemaNested<any>,
  ): NodeSchemaNested<any> {
    const $id = this.createNodeId()
    const cloned = toJS(node)
    const nodes = Array.isArray(cloned?.nodes) ? [...cloned.nodes] : []
    const res: NodeSchemaNested<any> = { ...cloned, $id, nodes: [] }
    for (const child of nodes) {
      const childDuplicate = this.createDuplicateNode({
        ...child,
        parentId: $id,
      })
      res.nodes!.push(childDuplicate)
    }
    return res
  }
  public addNodeFromPreset(
    preset: PresetSchema<any>,
    parent: NodeSchema<any>,
    index = NaN,
  ): NodeSchema<any> {
    if (!preset) throw new Error('Invalid preset')
    if (!parent) throw new Error('Invalid parent node')
    this.saveHistory()
    const presetJS = toJS(preset)
    const duplicate = this.createDuplicateNode(presetJS.data)
    duplicate.parentId = parent.$id
    const parsed = this.processNodesToDenormalized(duplicate)
    this.setNodes(parsed, true)

    runInAction(() => {
      if (isNaN(index)) (parent.nodes ||= []).push(duplicate.$id)
      else (parent.nodes ||= []).splice(index, 0, duplicate.$id)
    })

    return this.getNode(duplicate.$id)!
  }
  public updateNodeProps(
    node: NodeSchema<any>,
    props: NodeSchema<any>['props'],
  ): void {
    if (!node) throw new Error('Invalid node')
    this.saveHistory()
    node.props = { ...props }
  }

  public static nestDenormalizedNodes(
    nodes: NodesMap,
    rootId: NodeId = NODE_ROOT_ID,
  ): NodeSchemaNested<any> {
    const rootNode = nodes[rootId]
    if (!rootNode) throw new Error('Invalid root node')
    const response = { ...(rootNode as unknown as NodeSchemaNested<any>) }
    const children: NodeSchemaNested<any>[] = []
    for (const id of (rootNode.nodes ||= [])) {
      const child = { ...nodes[id] }
      const nestedChild = this.nestDenormalizedNodes(nodes, child.$id)
      children.push(nestedChild)
    }
    response.nodes = children
    return response
  }

  public denormalizeNodes(
    nodes: NodeSchemaNested<any>[],
    parentId: NodeId,
    accumulator: NodesMap = {},
  ): NodesMap {
    return CanvasManager.denormalizeNodes(nodes, parentId, accumulator)
  }
  public static denormalizeNodes(
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
      const nodesArray = [...(Array.isArray(nodes) ? nodes : [])].filter(
        Boolean,
      )
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
      this.denormalizeNodes(nodesArray, node.$id, accumulator)
    }

    return accumulator
  }

  public processNodesToDenormalized(value: ProcessableNodes): NodesMap {
    return CanvasManager.processNodesToDenormalized(value)
  }
  public static processNodesToDenormalized(value: ProcessableNodes): NodesMap {
    let response: NodesMap = {}
    const isArray = Array.isArray(value)

    if (isArray && value.length === 1) {
      const item = value[0]
      if (item?.$id === NODE_ROOT_ID) {
        response = this.denormalizeNodes(
          [{ ...item, parentId: null }],
          NODE_ROOT_ID,
          response,
        )
      } else if (item?.parentId === NODE_ROOT_ID || (item && item.parentId)) {
        response = this.denormalizeNodes(
          [{ $id: NODE_ROOT_ID, componentId: 'div', nodes: [item] }],
          NODE_ROOT_ID,
          response,
        )
      } else if (item?.parentId) {
        response = this.denormalizeNodes(
          [{ $id: item?.parentId, componentId: 'div', nodes: [item] }],
          item?.parentId,
          response,
        )
      } else {
        response = this.denormalizeNodes(
          [{ $id: NODE_ROOT_ID, componentId: 'div', nodes: [] }],
          NODE_ROOT_ID,
          response,
        )
      }
    } else if (isArray) {
      response = this.denormalizeNodes(
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
      response = this.denormalizeNodes(
        [_value],
        _value?.parentId || NODE_ROOT_ID,
        response,
      )
    } else {
      response = value as unknown as NodesMap
    }

    return response
  }
}

export default CanvasManager
