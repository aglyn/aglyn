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

import { PartialKeys } from '@aglyn/shared-data-types'
import { _isArr } from '@aglyn/shared-util-guards'
import { copy } from '@aglyn/shared-util-tools'
import { nanoid } from 'nanoid'
import Node, { type NodeId, type NodeSchema } from './node'

const NODE_ID_LENGTH = 10

export default class CanvasManager {
  public static Node = Node
  public static Component = Node
  public nodes = new Map<NodeId, Node<any>>()

  constructor(nodes: Record<NodeId, NodeSchema> = {}) {
    Object.entries(nodes).forEach(([, schema]) => {
      this.setNode(new CanvasManager.Node(schema))
    })
  }

  public toJSON(): Record<NodeId, NodeSchema> {
    return Object.fromEntries(this.nodes)
  }

  public static createNodeId(): string {
    return nanoid(NODE_ID_LENGTH)
  }

  public static createNode<P>(
    schema: PartialKeys<NodeSchema<P>, '$id'>,
  ): Node<P> {
    return new CanvasManager.Node({
      $id: CanvasManager.createNodeId(),
      ...schema,
    })
  }

  public setNode<P>(node: Node<P>): this {
    this.nodes.set(node.$id, node)
    return this
  }

  public deleteChildren<P>(node: Node<P>): this {
    const children = Array.isArray(node.nodes) ? node.nodes : []
    for (const childId of children) {
      const child = this.getNode(childId)
      if (child) {
        this.deleteChildren(child)
        this.deleteNode(child)
      }
    }
    return this
  }

  public deleteNode<P>(node: Node<P>): this {
    this.deleteChildren(node)
    this.nodes.delete(node.$id)
    return this
  }

  public getNode<P>($id: NodeId): Node<P> | undefined {
    return this.nodes.get($id)
  }

  public duplicateNode<P>(node: Node<P>, parentId?: NodeId): Node<P> {
    const copied = CanvasManager.createNode({
      ...copy(node.toJSON()),
      $id: CanvasManager.createNodeId(),
    })
    copied.$id = CanvasManager.createNodeId()
    copied.parentId = parentId
    copied.nodes = []

    for (const childId of _isArr(node.nodes) ? node.nodes : []) {
      const oldChild = this.getNode(childId)
      if (oldChild) {
        const newChild = this.duplicateNode(oldChild, copied.$id)
        copied.nodes.push(newChild.$id)
      }
    }
    this.setNode(copied)
    return copied
  }

  public reparentNode(
    node: Node<any>,
    oldParent: Node<any>,
    newParent: Node<any>,
    index: number,
  ): this {
    oldParent.nodes = oldParent.nodes.filter((id) => id !== node.$id)
    node.parentId = newParent.$id
    if (isNaN(index)) newParent.nodes.push(node.$id)
    else newParent.nodes.splice(index, 0, node.$id)

    this.nodes.set(oldParent.$id, oldParent)
    this.nodes.set(newParent.$id, newParent)
    this.nodes.set(node.$id, node)
    return this
  }
}
