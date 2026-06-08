/**
 * @license
 * Copyright 2023 Aglyn LLC
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
  destroy,
  getParent,
  getSnapshot,
  IAnyModelType,
  Instance,
  SnapshotIn,
  SnapshotOut,
  types as t,
} from 'mobx-state-tree'
import { createIdUrlSafe } from '../constants'
import {
  AnyJsonObject,
  Identifier,
  SafeId,
  SnapshotInOrId,
  SnapshotInOrInstance,
} from '../mst'
import { NodeType } from '../types/nodes'

export type AglynNodeModel = typeof AglynNodeModel
export type AglynNodeInstance = Instance<typeof AglynNodeModel>

export const AglynNodeModel = t
  .model('AglynNode', {
    id: SafeId,
    type: t.enumeration<NodeType>('NodeType', Object.values(NodeType)),
    name: t.maybe(t.string),
    pluginId: t.maybe(t.string),
    componentId: t.maybe(t.string),
    className: t.maybe(t.string),
    sx: t.maybe(AnyJsonObject),
    nodes: t.optional(
      t.array(t.safeReference(t.late((): IAnyModelType => AglynNodeModel))),
      [],
    ),
    parent: t.maybeNull(
      t.safeReference(t.late((): IAnyModelType => AglynNodeModel)),
    ),
  })
  .actions((self) => ({
    remove() {
      getParent<typeof RootNode>(self, 2).removeNode(self)
    },
  }))
  .views((self) => ({
    get nodesById(): OrUndef<AglynNodeInstance[]> {
      if (!self.nodes) return undefined
      const parentStore = getParent<typeof RootNode>(self, 2)
      const nodes: AglynNodeInstance[] = []
      for (const id of self.nodes || []) {
        const node = parentStore.getNode(id)
        nodes.push(node)
      }
      return nodes
    },
    get parentIndex(): OrUndef<number> {
      if (!self.parent) return -1
      return self.parent.nodes?.indexOf(self.id)
    },
  }))
  .preProcessSnapshot((snapshot) => {
    console.log('node aaa preProcessSnapshot', snapshot)
    return snapshot
  })
  .postProcessSnapshot((snapshot) => {
    console.log('node aaa postProcessSnapshot', snapshot)
    return snapshot
  })

export const RootNode = t
  .model('AglynRootNode', {
    nodes: t.optional(t.array(t.safeReference(AglynNodeModel)), []),
    nodesById: t.optional(t.map<AglynNodeModel>(AglynNodeModel), {}),
    sx: t.maybe(AnyJsonObject),
  })
  .actions((store) => {
    return {
      createNode,
      hasNode,
      getNode,
      addNode,
      removeNode,
      duplicateNode,
    }

    function createNode(node: SnapshotInOrInstance<AglynNodeModel>) {
      return AglynNodeModel.create(node as SnapshotIn<AglynNodeModel>)
    }
    function resolveNode(
      item: SnapshotInOrId<AglynNodeModel>,
    ): OrUndef<AglynNodeInstance> {
      return typeof item === 'string' ? getNode(item) : (item as AglynNodeInstance)
    }
    function hasNode(id: Identifier): boolean {
      return store.nodesById.has(id)
    }
    function getNode(id: Identifier): OrUndef<AglynNodeInstance> {
      return store.nodesById.get(id)
    }
    function addNode(
      node: SnapshotIn<AglynNodeModel> | AglynNodeInstance,
      index = -1,
    ) {
      const n = node as AglynNodeInstance
      const parent = n.parent ? getNode(n.parent as unknown as string) : store
      if (!parent) throw new Error('Parent not found')
      if (!Array.isArray(parent.nodes)) (parent as AglynNodeInstance).nodes = [] as unknown as AglynNodeInstance['nodes']
      store.nodesById.set(n.id, node as AglynNodeInstance)
      if (index === -1) {
        parent.nodes.push(n.id)
      } else {
        parent.nodes.splice(index, 0, n.id)
      }
    }
    function removeNode(item: SnapshotInOrId<AglynNodeModel>) {
      const node = resolveNode(item)
      if (node) {
        destroy(node)
      } else {
        throw new Error('Invalid node')
      }
    }

    function __cloneNode(
      item: SnapshotInOrId<AglynNodeModel>,
      parent?: OrUndef<Identifier>,
      accumulator: SnapshotIn<AglynNodeModel>[] = [],
    ): [
      newNode: SnapshotIn<AglynNodeModel>,
      accumulator: SnapshotIn<AglynNodeModel>[],
    ] {
      const resolved = resolveNode(item)
      if (!resolved) return [undefined, accumulator]
      const snapshot = getSnapshot<SnapshotOut<AglynNodeModel>>(resolved)
      const newParent = parent || (snapshot.parent as string | undefined)
      const clone: SnapshotIn<AglynNodeModel> = {
        ...snapshot,
        id: createIdUrlSafe(),
        parent: newParent,
        nodes: [] as string[],
      }
      accumulator.push(clone)
      for (const child of resolved.nodes || []) {
        const [childClone] = __cloneNode(child, clone.id, accumulator)
        if (childClone) {
          ;(clone.nodes as string[]).push(childClone.id)
          console.log('node aaa childClone', clone, childClone)
        } else {
          console.error('node aaa childClone', childClone)
        }
      }

      return [clone, accumulator]
    }
    function duplicateNode(item: SnapshotInOrId<AglynNodeModel>) {
      const resolved = resolveNode(item)
      if (!resolved) throw new Error('Invalid node')
      const [itemClone, allClones] = __cloneNode(
        resolved,
        resolved.parent as unknown as string | undefined,
      )
      console.log('node aaa itemClone', itemClone)

      for (const clone of allClones) {
        store.nodesById.set(clone.id, AglynNodeModel.create(clone))
      }
      const parent = resolved.parent || store
      const indexOf = resolved.parentIndex ?? -1

      if (indexOf === -1) parent.nodes.push(itemClone.id)
      else parent.nodes.splice(indexOf + 1, 0, itemClone.id)

      return itemClone.id
    }
  })

const rootNode = RootNode.create({
  nodes: ['foo'],
  nodesById: {
    foo: {
      id: 'foo',
      type: NodeType.NODE,
      sx: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'background',
        color: 'text',
        fontFamily: 'body',
        fontSize: 2,
        fontWeight: 'body',
        lineHeight: 'body',
      },
      nodes: ['bar'],
    },
    bar: {
      id: 'bar',
      type: NodeType.NODE,
      parent: 'foo',
      nodes: ['me'],
    },
    me: {
      id: 'me',
      type: NodeType.NODE,
      parent: 'bar',
    },
  },
})
