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

import * as Aglyn from '@aglyn/aglyn'
import { confirmValidLinealRelationship } from '@aglyn/core-util-app'
import { observable, runInAction } from 'mobx'
import { computedFn } from 'mobx-utils'

export enum DragType {
  CANVAS = 'canvas',
  TEMPLATE = 'template',
  TREE = 'tree',
}

export enum DropAreaType {
  BEFORE = 0x1,
  INSIDE = 0x2,
  AFTER = 0x3,
}

export type DraggableNode = Aglyn.NodeSchema<any> | Aglyn.PresetSchema<any>

export interface DndState {
  /**
   * The current drag object
   */
  drag: DraggableNode | null
  /**
   * The current drop object
   */
  drop: DraggableNode | null
  /**
   * Computed guard to check if dragging
   */
  readonly hasDragTarget: boolean
  /**
   * Computed guard to check if drop target available
   */
  readonly hasDropTarget: boolean
  /**
   * Computed drop object breadcrumb path
   */
  readonly dragBreadcrumbs: Aglyn.NodeBreadcrumbPath | false
  /**
   * Computed drop object breadcrumb path
   */
  readonly dropBreadcrumbs: Aglyn.NodeBreadcrumbPath | false
  /**
   * Computed check for valid lineal relationship
   */
  readonly isValidLinealRelationship: boolean
  /**
   * Computed guard fn if node is dragging
   */
  readonly isDraggingNode: (node: DraggableNode) => boolean
  /**
   * Computed guard fn if node is dragging the drop target
   */
  readonly isDraggingDropNode: (node: DraggableNode) => boolean
  /**
   * Computed guard fn if node is dragging the drop target
   */
  readonly isDraggingOverDropNode: (node: DraggableNode) => boolean
}

export const state = observable<DndState>({
  drag: null,
  drop: null,

  get hasDragTarget(): boolean {
    return Boolean(this.drag)
  },
  get hasDropTarget(): boolean {
    return Boolean(this.drop)
  },
  get dragBreadcrumbs(): Aglyn.NodeBreadcrumbPath | false {
    if (!this.hasDragTarget) return false
    return this.drag?.breadcrumbPath
  },
  get dropBreadcrumbs(): Aglyn.NodeBreadcrumbPath | false {
    if (!this.hasDropTarget) return false
    return this.drop?.breadcrumbPath
  },
  get isValidLinealRelationship(): boolean {
    if (!this.hasDragTarget) return false
    if (!this.hasDropTarget) return false
    if (this.drag?.type === Aglyn.NodeType.PRESET) {
      const itemNode = this.drag?.data
      const itemSchema = Aglyn.components.getSchema(itemNode?.componentId)
      return confirmValidLinealRelationship(
        {
          pluginId: this.drag?.data?.pluginId,
          componentId: itemNode?.componentId,
          restrictChildren: itemSchema?.restrictChildren,
          restrictParent: itemSchema?.restrictParent,
        },
        {
          pluginId: this.drop?.pluginId,
          componentId: this.drop?.componentId,
          restrictChildren: this.drop?.componentSchema?.restrictChildren,
          restrictParent: this.drop?.componentSchema?.restrictParent,
        },
      )[0]
    }
    return confirmValidLinealRelationship(
      {
        pluginId: this.drag?.pluginId,
        componentId: this.drag?.componentId,
        restrictChildren: this.drag?.componentSchema?.restrictChildren,
        restrictParent: this.drag?.componentSchema?.restrictParent,
      },
      {
        pluginId: this.drop?.pluginId,
        componentId: this.drop?.componentId,
        restrictChildren: this.drop?.componentSchema?.restrictChildren,
        restrictParent: this.drop?.componentSchema?.restrictParent,
      },
    )[0]
  },

  isDraggingNode: computedFn((node: DraggableNode): boolean => {
    if (!node) return false
    return node?.$id === state.drag?.$id
  }),
  isDraggingDropNode: computedFn((node: DraggableNode): boolean => {
    if (!node) return false
    return node?.$id === state.drop?.$id
  }),
  isDraggingOverDropNode: computedFn((node: DraggableNode): boolean => {
    if (!node) return false
    const breadcrumbs = state.dropBreadcrumbs
    return Array.isArray(breadcrumbs) && breadcrumbs.indexOf(node?.$id) >= 0
  }),
})

export function clearDndStatus() {
  runInAction(() => {
    state.drag = null
    state.drop = null
  })
}

export function setDragNode(dragNode: DraggableNode | null) {
  runInAction(() => {
    state.drag = dragNode || null
  })
}

export function setDropNode(dropNode: DraggableNode | null) {
  runInAction(() => {
    state.drop = dropNode || null
  })
}

export function isDraggingNode(node: DraggableNode): boolean {
  return state.isDraggingNode(node)
}

export function isDraggingDropNode(node: DraggableNode): boolean {
  return state.isDraggingDropNode(node)
}

export function isDraggingOverDropNode(node: DraggableNode): boolean {
  return state.isDraggingOverDropNode(node)
}
