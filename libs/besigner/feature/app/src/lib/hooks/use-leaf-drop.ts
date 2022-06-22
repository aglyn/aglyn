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
  BesignerDraggableItem,
  BesignerDroppableItem,
  DndDragType,
  DndDropType,
} from '@aglyn/besigner-data-app'
import type { ElementId } from '@aglyn/core-data-foundation'
import {
  useAglynCanvasElementHierarchy,
  useAglynComponentSchema,
  useAglynElementData,
} from '@aglyn/core-feature-renderer'
import {
  type ConnectDropTarget,
  type DropTargetMonitor,
  useDrop,
} from 'react-dnd'
import { useAglynCanvasSetHovered } from './use-aglyn-canvas-hovered'
import { useAglynDndSetOver } from './use-aglyn-dnd-over'

export type DropCollected = {
  isOver?: boolean
  isOverSelf?: boolean
  isOverChildren?: boolean
  isOverSameDrag?: boolean
  isOverChildOfSameDrag?: boolean
  isDragging?: boolean
}

export const useLeafDrop = (
  $id: ElementId,
  type?: DndDropType,
): [DropCollected, ConnectDropTarget] => {
  const dropType = type ?? DndDropType.INSIDE
  const componentId = useAglynElementData($id, 'componentId')
  const bundleId = useAglynElementData($id, 'bundleId')
  const componentSchema = useAglynComponentSchema(componentId, bundleId)
  const hierarchy = componentSchema?.hierarchy
  const setHovered = useAglynCanvasSetHovered()
  const setDndOver = useAglynDndSetOver()

  const trail = useAglynCanvasElementHierarchy($id)
  const dropItem: BesignerDroppableItem = {
    $id,
    type: dropType,
    componentId,
    bundleId,
    hierarchy,
  }

  return useDrop<BesignerDraggableItem, BesignerDroppableItem, DropCollected>(
    () => ({
      accept: Object.values(DndDragType),
      canDrop: (dragItem, monitor) => {
        const isOverDragItem = trail.indexOf(dragItem?.$id) >= 0
        const isOverSelf = monitor.isOver({ shallow: true })
        return isOverSelf && !isOverDragItem
      },
      drop: (dragItem, monitor) => {
        /**
         * If already handled return
         */
        if (monitor.didDrop()) return undefined
        return dropItem
      },
      hover: (dragItem, monitor) => {
        const isOverSelf = monitor.isOver({ shallow: true })
        if (!isOverSelf) return
        setHovered({ $id: dropItem?.$id })
        setDndOver(dropItem)
      },
      collect: (monitor: DropTargetMonitor) => {
        const dragItem = monitor.getItem<BesignerDraggableItem>()
        const isOver = monitor.isOver({ shallow: false })
        const isOverSelf = monitor.isOver({ shallow: true })
        const isOverChildren = isOver && !isOverSelf
        const isOverDragItem = trail.indexOf(dragItem?.$id) >= 0

        return {
          isOver,
          isOverSelf,
          isOverChildren,
          isOverDragItem,
        }
      },
    }),
    [dropItem, trail, setDndOver],
  )
}
export default useLeafDrop
