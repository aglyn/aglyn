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
import { observable, runInAction } from 'mobx'
import { computedFn } from 'mobx-utils'

export interface DndState {
  /**
   * The current drag object
   */
  drag?: Aglyn.NodeSchema | null
  /**
   * The current drop object
   */
  drop?: Aglyn.NodeSchema | null
  /**
   * Computed guard to check if dragging
   */
  readonly isDragging: boolean
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
   * Computed guard fn if node is dragging
   */
  readonly isDraggingNode: (node: Aglyn.NodeSchema<any>) => boolean
  /**
   * Computed guard fn if node is dragging the drop target
   */
  readonly isDraggingDropNode: (node: Aglyn.NodeSchema<any>) => boolean
  /**
   * Computed guard fn if node is dragging the drop target
   */
  readonly isDraggingOverDropNode: (node: Aglyn.NodeSchema<any>) => boolean
}

export const state = observable<DndState>({
  drag: null,
  drop: null,
  get isDragging(): boolean {
    return Boolean(this.drag)
  },
  get hasDropTarget(): boolean {
    return Boolean(this.drop)
  },
  get dragBreadcrumbs(): Aglyn.NodeBreadcrumbPath | false {
    if (!this.isDragging) return false
    return this.drag?.breadcrumbPath
  },
  get dropBreadcrumbs(): Aglyn.NodeBreadcrumbPath | false {
    if (!this.hasDropTarget) return false
    return this.drop?.breadcrumbPath
  },
  isDraggingNode: computedFn((node: Aglyn.NodeSchema<any>): boolean => {
    if (!node) return false
    return node?.$id === state.drag?.$id
  }),
  isDraggingDropNode: computedFn((node: Aglyn.NodeSchema<any>): boolean => {
    if (!node) return false
    return node?.$id === state.drop?.$id
  }),
  isDraggingOverDropNode: computedFn((node: Aglyn.NodeSchema<any>): boolean => {
    if (!node) return false
    const breadcrumbs = state.dropBreadcrumbs
    return Array.isArray(breadcrumbs) && breadcrumbs.indexOf(node?.$id) >= 0
  }),
})

export enum DragType {
  CANVAS = 'canvas',
  TEMPLATE = 'template',
  TREE = 'tree',
}

export enum DndDropType {
  BEFORE = 0x1,
  INSIDE = 0x2,
  AFTER = 0x3,
}

export function clearDndStatus() {
  runInAction(() => {
    state.drag = null
    state.drop = null
  })
}

export function setDragNode(dragNode: Aglyn.NodeSchema<any> | null) {
  runInAction(() => {
    state.drag = dragNode
  })
}

export function setDropNode(dropNode: Aglyn.NodeSchema<any> | null) {
  runInAction(() => {
    state.drop = dropNode
  })
}

export function isDraggingNode(node: Aglyn.NodeSchema<any>): boolean {
  return state.isDraggingNode(node)
}

export function isDraggingDropNode(node: Aglyn.NodeSchema<any>): boolean {
  return state.isDraggingDropNode(node)
}

export function isDraggingOverDropNode(node: Aglyn.NodeSchema<any>): boolean {
  return state.isDraggingOverDropNode(node)
}
