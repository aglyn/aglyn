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

export type Node = typeof Node
export type NodeInstance = Instance<typeof Node>

export const Node = t
  .model('AglynNode', {
    id: SafeId,
    type: t.enumeration<NodeType>('NodeType', Object.values(NodeType)),
    name: t.maybe(t.string),
    pluginId: t.maybe(t.string),
    componentId: t.maybe(t.string),
    className: t.maybe(t.string),
    sx: t.maybe(AnyJsonObject),
    nodes: t.optional(t.array(t.safeReference(t.late(() => Node))), []),
    parent: t.maybeNull(t.safeReference(t.late(() => Node))),
  })
  .actions((self) => ({
    remove() {
      getParent<typeof RootNode>(self, 2).removeNode(self)
    },
  }))
  .views((self) => ({
    // get parent() {
    //   if (!self.parentId) return undefined
    //   return getParent<typeof RootNode>(self, 2).getNode(self.parentId)
    // },
    get nodesById(): OrUndef<NodeInstance[]> {
      if (!self.nodes) return undefined
      const parentStore = getParent<typeof RootNode>(self, 2)
      const nodes: NodeInstance[] = []
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
    // console.log('node aaa preProcess isArrayType')
    return snapshot
  })
  .postProcessSnapshot((snapshot) => {
    console.log('node aaa postProcessSnapshot', snapshot)
    // if (snapshot.parent) snapshot.parent = snapshot.parent.id
    // if (snapshot.nodes) {
    //   snapshot.nodes = snapshot.nodes.map((node) => node.id)
    // }
    return snapshot
  })

export const RootNode = t
  .model('AglynRootNode', {
    nodes: t.optional(t.array(t.safeReference(Node)), []),
    nodesById: t.optional(t.map<Node>(Node), {}),
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

    function createNode(node: SnapshotInOrInstance<Node>) {
      return Node.create(node)
    }
    function resolveNode(item: SnapshotInOrId<Node>): OrUndef<NodeInstance> {
      return typeof item === 'string' ? getNode(item) : item
    }
    function hasNode(id: Identifier): boolean {
      return store.nodesById.has(id)
    }
    function getNode(id: Identifier): OrUndef<NodeInstance> {
      return store.nodesById.get(id)
    }
    function addNode(node: SnapshotInOrInstance<Node>, index = -1) {
      const parent = node.parent ? getNode(node.parent) : store
      if (!parent) throw new Error('Parent not found')
      if (!Array.isArray(parent.nodes)) parent.nodes = []
      store.nodesById.set(node.id, node)
      if (index === -1) {
        parent.nodes.push(node.id)
      } else {
        parent.nodes.splice(index, 0, node.id)
      }
    }
    function removeNode(item: SnapshotInOrId<Node>) {
      const node = resolveNode(item)
      if (node) {
        // for (const child of node.nodes || []) {
        //   removeNode(child)
        // }
        // if (node.parent) {
        //   node.parent.nodes?.remove(node.id)
        // }
        destroy(node)
      } else {
        throw new Error('Invalid node')
      }
    }

    function __cloneNode(
      item: SnapshotInOrId<Node>,
      parent?: OrUndef<Identifier>,
      accumulator: SnapshotIn<Node>[] = [],
    ): [newNode: SnapshotIn<Node>, accumulator: SnapshotIn<Node>[]] {
      const resolved = resolveNode(item)
      if (!resolved) return [undefined, accumulator]
      const snapshot = getSnapshot<SnapshotOut<Node>>(resolved)
      const newParent = parent || snapshot.parent
      const clone = {
        ...snapshot,
        id: createIdUrlSafe(),
        parent: newParent,
        nodes: [],
      }
      accumulator.push(clone)
      for (const child of resolved.nodes || []) {
        const [childClone] = __cloneNode(child, clone.id, accumulator)
        if (childClone) {
          clone.nodes.push(childClone.id)
          console.log('node aaa childClone', clone, childClone)
        } else {
          console.error('node aaa childClone', childClone)
        }
      }

      return [clone, accumulator]
    }
    function duplicateNode(item: SnapshotInOrId<Node>) {
      const resolved = resolveNode(item)
      if (!resolved) throw new Error('Invalid node')
      const [itemClone, allClones] = __cloneNode(resolved, resolved.parent)
      console.log('node aaa itemClone', itemClone)

      for (const clone of allClones) {
        store.nodesById.set(clone.id, Node.create(clone))
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
