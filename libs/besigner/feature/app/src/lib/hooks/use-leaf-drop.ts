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
import { confirmValidLinealRelationship } from '@aglyn/core-util-app'
import isEqual from 'lodash-es/isEqual'
import { useMemo } from 'react'
import { type ConnectDropTarget, useDrop } from 'react-dnd'
import { useAglynCanvasSetHovered } from './use-aglyn-canvas-hovered'
import { useAglynDndSetOver } from './use-aglyn-dnd-over'

export type DropCollected = {
  canDrop?: boolean
  isOver?: boolean
  isOverSelf?: boolean
  isOverChildren?: boolean
  isOverSameDrag?: boolean
  isOverChildOfSameDrag?: boolean
  isDragging?: boolean
}

export const useLeafDrop = (
  $id: ElementId,
  dropType?: DndDropType,
  acceptType?: DndDragType,
): [DropCollected, ConnectDropTarget] => {
  const type = dropType ?? DndDropType.INSIDE
  const accept = acceptType ?? Object.values(DndDragType)
  const componentId = useAglynElementData($id, 'componentId')
  const bundleId = useAglynElementData($id, 'bundleId')
  const componentSchema = useAglynComponentSchema(componentId, bundleId)
  const hierarchy = componentSchema?.hierarchy
  const setHovered = useAglynCanvasSetHovered()
  const setDndOver = useAglynDndSetOver()

  const trail = useAglynCanvasElementHierarchy($id)
  const dropItem: BesignerDroppableItem = useMemo(
    () => ({
      $id,
      type,
      componentId,
      bundleId,
      hierarchy,
    }),
    [$id, type, componentId, bundleId, hierarchy],
  )

  return useDrop<BesignerDraggableItem, BesignerDroppableItem, DropCollected>(
    () => ({
      options: {
        arePropsEqual: (props, otherProps) => {
          console.log('arePropsEqual', props, otherProps)
          return isEqual(props, otherProps)
        },
      },
      accept: accept,
      canDrop: (dragItem, monitor) => {
        const isOverDragItem = trail.indexOf(dragItem?.$id) >= 0
        const isOverSelf = monitor.isOver({ shallow: true })
        const [validRelationship] = confirmValidLinealRelationship({
          item: dragItem,
          parent: dropItem,
        })
        return Boolean(isOverSelf && !isOverDragItem && validRelationship)
      },
      drop: (dragItem, monitor) => {
        /**
         * If already handled return
         */
        if (monitor.didDrop()) return undefined
        return dropItem
      },
      hover: (dragItem, monitor) => {
        // Make sure not to bubble up for parents
        if (!monitor.isOver({ shallow: true })) return
        setHovered({ $id: dropItem?.$id })
        setDndOver(dropItem)
      },
      collect: (monitor) => {
        const canDrop = monitor.canDrop()
        const dragItem = monitor.getItem()
        const isOver = monitor.isOver({ shallow: false })
        const isOverSelf = monitor.isOver({ shallow: true })
        const isOverChildren = isOver && !isOverSelf
        const isOverDragItem = trail.indexOf(dragItem?.$id) >= 0

        return {
          canDrop,
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
