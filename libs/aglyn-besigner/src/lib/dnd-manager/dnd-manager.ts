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

import * as Aglyn from '@aglyn/aglyn'
import { confirmValidLinealRelationship } from '@aglyn/core-util-app'
import { makeAutoObservable } from 'mobx'

export enum DragType {
  CANVAS = 'canvas',
  PRESET = 'preset',
  TREE = 'tree',
}

export enum DropAreaType {
  BEFORE = 0x1,
  INSIDE = 0x2,
  AFTER = 0x3,
}

export enum DropRegion {
  CHILDREN = 'children',
  TOP = 'top',
  RIGHT = 'right',
  BOTTOM = 'bottom',
  LEFT = 'left',
}

export type DraggableNode = Aglyn.NodeSchema<any> | Aglyn.PresetSchema<any>

export class DndManager {
  drag?: DraggableNode = null
  drop?: DraggableNode = null
  dropRegion?: any = null
  public get intoArea(): DropAreaType {
    switch (this.dropRegion) {
      case DropRegion.TOP:
      case DropRegion.LEFT:
        return DropAreaType.BEFORE
      case DropRegion.RIGHT:
      case DropRegion.BOTTOM:
        return DropAreaType.AFTER
    }

    return DropAreaType.INSIDE
  }

  public get computedDrop() {
    if (!this.drop) return this.drop
    if (Aglyn.canvas.isRootNode(this.drop)) return this.drop
    if (!this.dropRegion) return this.drop
    if (this.dropRegion === DropRegion.CHILDREN) return this.drop
    return Aglyn.canvas.getNode(this.drop.$id).parent
  }

  public get hasDragTarget(): boolean {
    return Boolean(this.drag)
  }
  public get hasDropTarget(): boolean {
    return Boolean(this.drop)
  }
  public get dragBreadcrumbs(): Aglyn.NodeBreadcrumbPath | false {
    if (!this.hasDragTarget) return false
    return this.drag?.breadcrumbPath
  }
  public get dropBreadcrumbs(): Aglyn.NodeBreadcrumbPath | false {
    if (!this.hasDropTarget) return false
    return this.drop?.breadcrumbPath
  }
  public get dropIsInsideDrag() {
    return Boolean(
      this.computedDrop?.breadcrumbPath?.some((i) => i === this.drag?.$id),
    )
  }
  public get isValidLinealRelationship(): boolean {
    if (!this.hasDragTarget) return false
    if (!this.hasDropTarget) return false
    const parent = {
      pluginId: this.computedDrop?.pluginId,
      componentId: this.computedDrop?.$id,
      restrictChildren: this.computedDrop?.componentSchema?.restrictChildren,
      restrictParent: this.computedDrop?.componentSchema?.restrictParent,
    }

    if (this.drag?.type === Aglyn.NodeType.PRESET) {
      const preset = this.drag as Aglyn.PresetSchema<any>
      const itemNode = preset.data
      const itemSchema = Aglyn.components.getSchema(itemNode?.$id)
      return confirmValidLinealRelationship(
        {
          pluginId: preset.data?.pluginId,
          componentId: itemNode?.$id,
          restrictChildren: itemSchema?.restrictChildren,
          restrictParent: itemSchema?.restrictParent,
        },
        parent,
      )[0]
    }
    return confirmValidLinealRelationship(
      {
        pluginId: this.drag?.pluginId,
        componentId: this.drag?.$id,
        restrictChildren: this.drag?.componentSchema?.restrictChildren,
        restrictParent: this.drag?.componentSchema?.restrictParent,
      },
      parent,
    )[0]
  }

  constructor() {
    makeAutoObservable(this)
  }

  public isDraggingNode(node: DraggableNode): boolean {
    if (!node) return false
    return node?.$id === this.drag?.$id
  }
  public isDraggingDropNode(node: DraggableNode): boolean {
    if (!node) return false
    return node?.$id === this.drop?.$id
  }
  public isDraggingOverDropNode(node: DraggableNode): boolean {
    if (!node) return false
    const breadcrumbs = this.dropBreadcrumbs
    return Array.isArray(breadcrumbs) && breadcrumbs.indexOf(node?.$id) >= 0
  }
  canDragNode(node: DraggableNode): boolean {
    if (!node) throw new Error('Invalid node')
    switch (true) {
      case Aglyn.canvas.isRootNode(node):
        return false
      case node?.type === Aglyn.NodeType.PRESET:
        return true
      case node?.type === Aglyn.NodeType.NODE:
        return Aglyn.isFeatureEnabled(
          (node as Aglyn.NodeSchema<any>)?.componentSchema?.flags?.dragging,
        )
      default:
        return false
    }
  }

  public clearDndStatus() {
    this.drag = null
    this.drop = null
    this.dropRegion = null
    return this
  }

  public setDragNode(node: DraggableNode) {
    this.drag = node || null
    return this
  }
  public setDropNode(node: DraggableNode) {
    this.drop = node || null
    return this
  }
  public setDropRegion(region: DropRegion) {
    this.dropRegion = region || null
    return this
  }
  public onDragEnd() {
    if (!this.drop || !this.drag) return
    if (this.dropIsInsideDrag) return
    if (!this.isValidLinealRelationship) return

    const dragNode = this.drag
    const dropNode = this.drop
    const region = this.dropRegion
    const before = region === DropRegion.TOP || region === DropRegion.LEFT
    const after = region === DropRegion.RIGHT || region === DropRegion.BOTTOM
    let position = NaN
    let parent = null

    if (before || after) {
      parent = Aglyn.canvas.getNode(dropNode.parentId)
      position = Aglyn.canvas.getNodeIndex(dropNode)
      if (after) position = position + 1
    } else {
      parent = Aglyn.canvas.getNode(dropNode.$id)
    }

    if (dragNode.type === Aglyn.NodeType.PRESET) {
      // console.log('drag node', dragNode)
      const newNode = Aglyn.canvas.addNodeFromPreset(dragNode as Aglyn.PresetSchema<any>, parent, position)
      console.log('new node', newNode)
      // Besigner.focus.setSelectedNode(newNode)
    } else {
      Aglyn.canvas.reparentNode(dragNode, parent, position)
    }

    console.log('handleDragEnd dragNode', dragNode)
    console.log('handleDragEnd dropNode', dropNode)
    this.clearDndStatus()
  }
}

export default DndManager
