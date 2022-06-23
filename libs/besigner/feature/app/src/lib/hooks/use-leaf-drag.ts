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

import {
  type BesignerDraggableItem,
  type BesignerDroppableItem,
  DndDragType,
} from '@aglyn/besigner-data-app'
import { isRootElementId, moveCanvasElement } from '@aglyn/core-data-app'
import type { ElementId } from '@aglyn/core-data-foundation'
import { FEATURE_FLAG } from '@aglyn/core-data-foundation'
import {
  useAglynAppContext,
  useAglynElementComponentSchema,
} from '@aglyn/core-feature-renderer'
import {
  type ConnectDragPreview,
  type ConnectDragSource,
  useDrag,
} from 'react-dnd'
import { useAglynCanvasSetSelected } from './use-aglyn-canvas-selected'
import { useAglynDndSetActive } from './use-aglyn-dnd-active'
import { useAglynDndSetOver } from './use-aglyn-dnd-over'

export type DragCollected = {
  isDragging?: boolean
  active?: BesignerDraggableItem
  over?: BesignerDroppableItem
}

export const useLeafDrag = (
  $id: ElementId,
  type?: DndDragType,
): [DragCollected, ConnectDragSource, ConnectDragPreview] => {
  const dragType = type ?? DndDragType.CANVAS_ELEMENT
  const app = useAglynAppContext()
  const setSelected = useAglynCanvasSetSelected()
  const setDndActive = useAglynDndSetActive()
  const setDndOver = useAglynDndSetOver()
  const schema = useAglynElementComponentSchema($id)
  const componentId = schema?.componentId
  const bundleId = schema?.bundleId
  const hierarchy = schema?.hierarchy
  const disableDrag = schema?.features?.dragging === FEATURE_FLAG.DISABLED
  const dragItem = {
    $id,
    type: dragType,
    componentId,
    bundleId,
    hierarchy,
  }

  return useDrag<BesignerDraggableItem, BesignerDroppableItem, DragCollected>(
    () => ({
      type: dragType,
      item: () => {
        console.log('draggable item', dragItem)
        setSelected({ $id })
        setDndActive(dragItem)
        return dragItem
      },
      end: (dragItem, monitor) => {
        const dropItem = monitor.getDropResult()
        setDndActive(undefined)
        setDndOver(undefined)
        if (!dropItem) return
        console.log('end drag ', dragItem, dropItem)
        moveCanvasElement(app, {
          $id: dragItem.$id,
          parentId: dropItem?.$id,
          index: NaN,
        })
      },
      isDragging: (monitor) => monitor?.getItem()?.$id === dragItem?.$id,
      canDrag: !isRootElementId($id) && !disableDrag,
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
        // dropItem: monitor.getDropResult(),
        // active: monitor.getItem(),
      }),
    }),
    [dragItem, app, dragType],
  )
}
export default useLeafDrag
