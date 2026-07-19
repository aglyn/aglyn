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
import {
  confirmValidLinealRelationship,
  type ConfirmValidLinealRelationshipResponse,
  describeInvalidLinealRelationship,
  type InvalidLinealRelationFlag,
  type LinealItem,
} from './confirm-valid-lineal-relationship'
import { makeAutoObservable } from 'mobx'
import { getSelected, isNodeSelected } from '../focus-manager/focus-manager'

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
  dropRegion?: DropRegion | null = null
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
    if (this.dropRegion === DropRegion.CHILDREN) {
      // A leaf (self-closing / text-editable) has no slot for node children,
      // so a center/CHILDREN drop resolves against its PARENT and lands as a
      // sibling — mirroring the Insert menu's leaf handling (AGL-575). This
      // also makes the lineal check validate against the real parent instead
      // of the leaf, which (declaring no restrictChildren) would wrongly pass.
      const node = Aglyn.canvas.getNode(this.drop.$id)
      if (node && !Aglyn.canvas.nodeAcceptsChildren(node)) return node.parent
      return this.drop
    }
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
  /**
   * Multi-drag (AGL-13): when the dragged node is part of the current
   * multi-selection, every draggable selected node moves; otherwise just
   * the dragged node. Presets never join a selection.
   */
  public get dragNodes(): DraggableNode[] {
    if (
      this.drag &&
      this.drag.type === Aglyn.NodeType.NODE &&
      isNodeSelected(this.drag as Aglyn.NodeSchema<any>)
    ) {
      const selected = getSelected().filter((node) => this.canDragNode(node))
      if (selected.length > 1) {
        // Document order (not selection order) so relative positions
        // survive the move: compare breadcrumb paths by sibling index.
        const orderKey = (node: Aglyn.NodeSchema<any>): number[] =>
          (node.breadcrumbPath ?? []).map((id) => {
            try {
              return Aglyn.canvas.getNodeIndex(Aglyn.canvas.getNode(id))
            } catch {
              return 0
            }
          })
        return [...selected].sort((a, b) => {
          const left = orderKey(a)
          const right = orderKey(b)
          for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
            const diff = (left[i] ?? -1) - (right[i] ?? -1)
            if (diff !== 0) return diff
          }
          return 0
        })
      }
      if (selected.length === 1) return selected
    }
    return this.drag ? [this.drag] : []
  }
  /** Item/parent descriptors for the pending drop, or null without targets. */
  private get dropRelationshipActors(): {
    item: LinealItem
    parent: LinealItem
  } | null {
    if (!this.hasDragTarget || !this.hasDropTarget) return null
    const parent: LinealItem = {
      pluginId: this.computedDrop?.pluginId,
      componentId: this.computedDrop?.componentId,
      restrictChildren: this.computedDrop?.componentSchema?.restrictChildren,
      restrictParent: this.computedDrop?.componentSchema?.restrictParent,
    }

    if (this.drag?.type === Aglyn.NodeType.PRESET) {
      const preset = this.drag as Aglyn.PresetSchema<any>
      const itemNode = preset.data
      const itemSchema = Aglyn.components.getSchema(itemNode?.componentId)
      return {
        item: {
          pluginId: preset.data?.pluginId,
          componentId: itemNode?.componentId,
          restrictChildren: itemSchema?.restrictChildren,
          restrictParent: itemSchema?.restrictParent,
        },
        parent,
      }
    }
    return {
      item: {
        pluginId: this.drag?.pluginId,
        componentId: this.drag?.componentId,
        restrictChildren: this.drag?.componentSchema?.restrictChildren,
        restrictParent: this.drag?.componentSchema?.restrictParent,
      },
      parent,
    }
  }

  public get linealValidation(): ConfirmValidLinealRelationshipResponse {
    const actors = this.dropRelationshipActors
    if (!actors) return [false, 0 as InvalidLinealRelationFlag]
    return confirmValidLinealRelationship(actors.item, actors.parent)
  }

  public get isValidLinealRelationship(): boolean {
    return this.linealValidation[0]
  }

  /**
   * Human-readable reason the pending drop would be rejected, or null when
   * the drop is valid (or there is nothing to validate). Read this before
   * onDragEnd — completing the drag clears the dnd state.
   */
  public describeDropRejection(): string | null {
    const actors = this.dropRelationshipActors
    if (!actors) return null
    if (this.dropIsInsideDrag) {
      return "An element can't be moved inside itself"
    }
    const [valid, reason] = confirmValidLinealRelationship(
      actors.item,
      actors.parent,
    )
    if (valid) return null
    return describeInvalidLinealRelationship(actors.item, actors.parent, reason)
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
      const dropTarget = Aglyn.canvas.getNode(dropNode.$id)
      // Leaf redirect (AGL-575 parallel): a self-closing / text-editable
      // target has no children slot, so a center drop becomes a sibling right
      // after it rather than a nested child. Non-leaf containers still nest.
      if (
        dropTarget &&
        dropNode.parentId &&
        !Aglyn.canvas.nodeAcceptsChildren(dropTarget)
      ) {
        const leafIndex = Aglyn.canvas.getNodeIndex(dropTarget)
        parent = Aglyn.canvas.getNode(dropNode.parentId)
        if (leafIndex > -1) position = leafIndex + 1
      } else {
        parent = dropTarget
      }
    }

    if (dragNode.type === Aglyn.NodeType.PRESET) {
      Aglyn.canvas.addNodeFromPreset(dragNode as Aglyn.PresetSchema<any>, parent, position)
      // Besigner.focus.setSelectedNode(newNode)
    } else {
      // Multi-drag (AGL-13): move the whole selection when the dragged
      // node is selected. Per-node guards mirror the single-node checks —
      // nodes that contain the drop target or fail the lineal rules are
      // skipped rather than failing the whole move. Sequential inserts
      // with an advancing position preserve document order (CANVAS and
      // TREE drags both land here).
      const parentSchema = Aglyn.components.getSchema(parent?.componentId)
      for (const node of this.dragNodes) {
        if (node.type !== Aglyn.NodeType.NODE) continue
        const containsDrop = Boolean(
          this.computedDrop?.breadcrumbPath?.some((id) => id === node.$id),
        )
        if (containsDrop) continue
        const [valid] = confirmValidLinealRelationship(
          {
            pluginId: node.pluginId,
            componentId: node.componentId,
            restrictChildren: (node as Aglyn.NodeSchema<any>)
              ?.componentSchema?.restrictChildren,
            restrictParent: (node as Aglyn.NodeSchema<any>)?.componentSchema
              ?.restrictParent,
          },
          {
            pluginId: parent?.pluginId,
            componentId: parent?.componentId,
            restrictChildren: parentSchema?.restrictChildren,
            restrictParent: parentSchema?.restrictParent,
          },
        )
        if (!valid) continue
        Aglyn.canvas.reparentNode(node, parent, position)
        if (!Number.isNaN(position)) position += 1
      }
    }

    this.clearDndStatus()
  }
}

export default DndManager
